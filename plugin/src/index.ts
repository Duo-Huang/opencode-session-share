import { Plugin } from "@opencode/plugin"
import { compactForUpload } from "./compact"
import { SessionShareRpc } from "./rpc"
import {
  createShare,
  endpoint,
  generateShareKeyPair,
  prepareShare,
  revokeBySession,
  syncShare,
  type PluginOptions,
  type ShareMeta,
} from "./client"
import { normalizeSession } from "./normalize"
import { parseShareKey, shareKey, SHARE_PREFIX } from "./storage"

type StoredShare = ShareMeta & {
  privateKey: string
  directory: string
  /** Base URL of the service that owns this share. */
  endpoint?: string
}

type ShareState = StoredShare & {
  sessionID: string
  storageKey: string
  timer?: ReturnType<typeof setTimeout>
  dirty: boolean
  syncing: boolean
  lastEventAt?: number
}

type StoredShareItem = {
  key: string
  sessionID: string
  directory: string
  stored: StoredShare
}

const SHARE_CONSENT_KEY = "share_consent_v2"

const EXECUTION_EVENTS = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] as const

const TERMINAL_EXECUTION_EVENTS = new Set<string>([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

// Mirror the TUI's busy state: started → running, any terminal event → idle.
const executionRunning = (type: string): boolean | undefined => {
  if (type === "session.execution.started") return true
  if (TERMINAL_EXECUTION_EVENTS.has(type)) return false
  return undefined
}

// Content is uploaded at part boundaries, not for every delta. Execution
// lifecycle events drive the live "running" state.
const RELEVANT_EVENTS = new Set<string>([
  "session.idle",
  ...EXECUTION_EVENTS,
  "session.deleted",
  "session.renamed",
  "session.metadata.updated",
  "session.model.selected",
  "session.agent.selected",
  "session.inbox.delivered",
  "session.synthetic",
  "session.text.ended",
  "session.reasoning.ended",
  "session.tool.success",
  "session.tool.failed",
  "session.shell.ended",
  "session.step.ended",
  "session.step.failed",
  "session.compaction.ended",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
])

const millis = (value: unknown) => {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === "object") {
    const record = value as { epochMillis?: unknown; epochMilliseconds?: unknown }
    if (typeof record.epochMillis === "number") return record.epochMillis
    if (typeof record.epochMilliseconds === "number") return record.epochMilliseconds
  }
  return undefined
}

// The same persisted state that backs the TUI's loading indicator: the
// execution projector writes `time.busy` on session.execution.started and
// `time.idle` on the terminal events.
const persistedRunning = (info: unknown) => {
  const time = (info as { time?: { busy?: unknown; idle?: unknown } } | undefined)?.time
  const busy = millis(time?.busy)
  if (busy === undefined) return undefined
  return busy > (millis(time?.idle) ?? 0)
}

export default Plugin.define({
  id: "opencode-session-share",
  async setup(ctx) {
    const pluginOptions = ctx.options as PluginOptions
    const shares = new Map<string, ShareState>()
    const busySessions = new Map<string, boolean>()
    const controller = new AbortController()

    const configuredEndpoint = () => {
      try {
        return endpoint(pluginOptions)
      } catch {
        return ""
      }
    }

    const sameEndpoint = (left: string, right: string) =>
      left.replace(/\/+$/, "") === right.replace(/\/+$/, "")

    const storedEndpoint = (stored: StoredShare, current: string) => {
      if (stored.endpoint) return stored.endpoint
      try {
        return new URL(stored.url).origin
      } catch {
        return current
      }
    }

    const toStored = (state: ShareState): StoredShare => ({
      id: state.id,
      url: state.url,
      expiresAt: state.expiresAt,
      ...(state.updatedAt !== undefined ? { updatedAt: state.updatedAt } : {}),
      privateKey: state.privateKey,
      directory: state.directory,
      ...(state.endpoint ? { endpoint: state.endpoint } : {}),
    })

    const scanStoredShares = async () => {
      const items: StoredShareItem[] = []
      const legacyKeys: string[] = []
      let after: string | undefined

      // A share can be created from any directory, and the TUI may restart in
      // a different project directory. Scan all share keys.
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await ctx.storage.scan({ prefix: SHARE_PREFIX, limit: 200, after })
        for (const entry of page.entries) {
          const parsed = parseShareKey(entry.key)
          if (!parsed) continue
          const stored = entry.value as
            | (Partial<StoredShare> & { secret?: string })
            | undefined
          if (stored && !stored.privateKey) {
            // v1 metadata used a shared secret and cannot participate in the
            // signed protocol. Drop it; old remote shares expire on their own.
            if (stored.secret) legacyKeys.push(entry.key)
            continue
          }
          if (
            !stored?.id ||
            !stored.privateKey ||
            !stored.url ||
            typeof stored.expiresAt !== "number"
          ) {
            continue
          }
          items.push({
            key: entry.key,
            sessionID: parsed.sessionID,
            directory: stored.directory ?? parsed.directory,
            stored: stored as StoredShare,
          })
        }
        if (!page.next || page.next === after) break
        after = page.next
      }

      for (const key of legacyKeys) {
        try {
          await ctx.storage.remove(key)
        } catch {
          // Best effort. A stale v1 key is ignored by the signed client.
        }
      }

      return items
    }

    const findStoredShare = async (
      sessionID: string,
    ): Promise<StoredShareItem | undefined> => {
      const current = configuredEndpoint()
      if (!current) return undefined
      const state = shares.get(sessionID)
      if (state) {
        return {
          key: state.storageKey,
          sessionID,
          directory: state.directory,
          stored: toStored(state),
        }
      }
      return (await scanStoredShares()).find(
        (item) =>
          item.sessionID === sessionID &&
          sameEndpoint(storedEndpoint(item.stored, current), current),
      )
    }

    // Use the session's own project directory when creating a share, not the
    // directory of whichever plugin instance happens to be handling it.
    const readSnapshot = async (sessionID: string, fallbackDirectory: string) => {
      const info = await ctx.session.get({ sessionID })
      const sessionDirectory =
        (info as { location?: { directory?: string } }).location?.directory ??
        fallbackDirectory
      const messages = (await ctx.session.context({ sessionID })) as readonly any[]
      const persisted = persistedRunning(info)

      // The persisted projector state is authoritative when it is idle.
      // A stale in-memory busy flag must not keep a stopped session running.
      if (persisted === false) busySessions.delete(sessionID)
      const running =
        persisted === false ? false : (busySessions.get(sessionID) ?? persisted)

      return {
        snapshot: normalizeSession(
          ctx.app,
          { directory: sessionDirectory },
          info,
          messages,
          running,
        ),
        sessionDirectory,
      }
    }

    const stopState = (sessionID: string) => {
      const state = shares.get(sessionID)
      if (!state) return
      if (state.timer) clearTimeout(state.timer)
      shares.delete(sessionID)
    }

    const forgetShare = async (sessionID: string, directory?: string) => {
      const state = shares.get(sessionID)
      const endpoint = state ? storedEndpoint(state, configuredEndpoint()) : configuredEndpoint()
      const key =
        state?.storageKey ??
        shareKey(endpoint, directory ?? ctx.location.directory, sessionID)
      stopState(sessionID)
      busySessions.delete(sessionID)
      try {
        await ctx.storage.remove(key)
      } catch (error) {
        console.warn("session-share: failed to remove local share key", error)
      }
    }

    const flush = async (sessionID: string) => {
      const state = shares.get(sessionID)
      if (!state) return
      if (state.syncing) {
        state.dirty = true
        return
      }
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = undefined
      }
      state.syncing = true
      state.dirty = false
      try {
        const { snapshot } = await readSnapshot(sessionID, state.directory)
        await syncShare(state.id, state.privateKey, snapshot, pluginOptions)
      } catch (error) {
        const status = (error as Error & { status?: number }).status
        if (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          status === 409 ||
          status === 410
        ) {
          await forgetShare(sessionID, state.directory)
          return
        }
        console.warn("session-share sync failed", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        const current = shares.get(sessionID)
        if (current) {
          current.timer = setTimeout(() => void flush(sessionID), 3000)
          current.timer.unref?.()
        }
      } finally {
        state.syncing = false
        if (state.dirty) {
          state.dirty = false
          void flush(sessionID)
        }
      }
    }

    const schedule = (sessionID: string, immediate = false) => {
      const state = shares.get(sessionID)
      if (!state) return
      if (immediate) {
        void flush(sessionID)
        return
      }
      if (state.timer) return
      state.timer = setTimeout(() => void flush(sessionID), 1000)
      state.timer.unref?.()
    }

    const rememberShare = async (
      sessionID: string,
      share: StoredShare,
      previousKey?: string,
    ) => {
      const current = configuredEndpoint()
      const { endpoint: existing, ...rest } = share
      const stored: StoredShare = {
        ...rest,
        ...(existing || current ? { endpoint: existing ?? current } : {}),
      }
      const endpoint = storedEndpoint(stored, current)
      const storageKey = shareKey(endpoint, stored.directory, sessionID)
      const previous = shares.get(sessionID)

      await ctx.storage.set(storageKey, stored)

      // Drop a legacy key only for the same server. Another endpoint's share
      // must stay in storage so switching back can still reuse it.
      if (previousKey && previousKey !== storageKey) {
        await ctx.storage.remove(previousKey).catch(() => {})
      } else if (
        previous?.storageKey &&
        previous.storageKey !== storageKey &&
        sameEndpoint(storedEndpoint(previous, current), endpoint)
      ) {
        await ctx.storage.remove(previous.storageKey).catch(() => {})
      }

      if (previous?.timer) clearTimeout(previous.timer)
      shares.set(sessionID, {
        ...stored,
        sessionID,
        storageKey,
        dirty: false,
        syncing: false,
        lastEventAt: previous?.lastEventAt,
      })
    }

    const unshare = async (sessionID: string) => {
      const state = shares.get(sessionID)
      const found = state
        ? {
            key: state.storageKey,
            directory: state.directory,
            stored: toStored(state),
          }
        : await findStoredShare(sessionID)
      const directory = state?.directory ?? found?.directory ?? ctx.location.directory
      const endpoint = state ? storedEndpoint(state, configuredEndpoint()) : configuredEndpoint()
      const key =
        state?.storageKey ??
        found?.key ??
        shareKey(endpoint, directory, sessionID)
      stopState(sessionID)
      busySessions.delete(sessionID)

      try {
        const result = await revokeBySession(sessionID, pluginOptions)
        try {
          await ctx.storage.remove(key)
        } catch (error) {
          // The remote share is already revoked. A leftover local key is
          // harmless and will be dropped the next time it is read.
          console.warn("session-share: failed to remove local share key", error)
        }
        return { revoked: result.revoked }
      } catch (error) {
        const status = (error as Error & { status?: number }).status
        if (status === 410 || status === 404) {
          await ctx.storage.remove(key)
          return { revoked: false }
        }

        // Keep the share metadata locally so the user can retry /unshare.
        if (found && found.stored.expiresAt > Date.now()) {
          shares.set(sessionID, {
            ...found.stored,
            directory,
            sessionID,
            storageKey: key,
            dirty: false,
            syncing: false,
          })
        }
        throw error
      }
    }

    const registration = await ctx.rpc.register(SessionShareRpc, {
      prepareShare: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const found = await findStoredShare(sessionID)
        if (found && found.stored.expiresAt > Date.now()) {
          if (!shares.has(sessionID)) {
            shares.set(sessionID, {
              ...found.stored,
              directory: found.directory,
              sessionID,
              storageKey: found.key,
              dirty: false,
              syncing: false,
            })
          }
          // Existing share: answer from local storage immediately; verify in the
          // background so a remote /unshare eventually clears the stale entry.
          void prepareShare(sessionID, pluginOptions)
            .then((existing) => {
              if (!existing) return forgetShare(sessionID, found.directory)
              const state = shares.get(sessionID)
              if (state && (state.url !== existing.url || state.expiresAt !== existing.expiresAt)) {
                state.url = existing.url
                state.expiresAt = existing.expiresAt
                void ctx.storage.set(state.storageKey, toStored(state)).catch(() => {})
              }
            })
            .catch(() => {})
          // /share is an explicit user action: refresh the page with the current
          // session snapshot once. This is not a periodic background sync.
          schedule(sessionID, true)
          return {
            consentRequired: false,
            share: {
              id: found.stored.id,
              url: found.stored.url,
              expiresAt: found.stored.expiresAt,
            },
          }
        }

        const existing = await prepareShare(sessionID, pluginOptions)
        const consent = (await ctx.storage.get(SHARE_CONSENT_KEY)) === true
        if (existing && found) {
          // The local private key is still available. Refresh the fixed expiry
          // from the server rather than creating a new share.
          await rememberShare(
            sessionID,
            {
              ...found.stored,
              directory: found.directory,
              url: existing.url,
              expiresAt: existing.expiresAt,
            },
            found.key,
          )
          return { consentRequired: false, share: existing }
        }
        // A remote share without a local private key cannot be updated. The
        // next share call creates/updates it with a fresh Ed25519 keypair.
        return { consentRequired: !consent, share: null }
      },
      share: async (input) => {
        const { sessionID, consent } = input as { sessionID: string; consent?: boolean }
        const existing = await prepareShare(sessionID, pluginOptions)
        const found = await findStoredShare(sessionID)
        if (existing && found) {
          await rememberShare(
            sessionID,
            {
              ...found.stored,
              directory: found.directory,
              url: existing.url,
              expiresAt: existing.expiresAt,
            },
            found.key,
          )
          schedule(sessionID, true)
          return {
            id: existing.id,
            url: existing.url,
            expiresAt: existing.expiresAt,
          }
        }

        const allowed = (await ctx.storage.get(SHARE_CONSENT_KEY)) === true || consent === true
        if (!allowed) throw new Error("Share consent required")
        if (consent === true) await ctx.storage.set(SHARE_CONSENT_KEY, true)

        const { snapshot, sessionDirectory } = await readSnapshot(
          sessionID,
          ctx.location.directory,
        )
        if (!snapshot.messages.length) {
          throw new Error("Session has no shareable messages yet")
        }
        const compacted = compactForUpload(snapshot, pluginOptions.uploadBudget)
        const keyPair = generateShareKeyPair()
        const result = await createShare(compacted, keyPair.publicKey, pluginOptions)
        const stored: StoredShare = {
          id: result.id,
          url: result.url,
          expiresAt: result.expiresAt,
          privateKey: keyPair.privateKey,
          directory: sessionDirectory,
          endpoint: configuredEndpoint() || undefined,
        }
        await rememberShare(sessionID, stored)

        // The initial upload is bounded for latency. If it was compacted, upload
        // the full snapshot once now; this is a one-shot completion, not a
        // periodic background sync. Re-sync when the service supports the
        // running flag so the first snapshot can show live activity.
        if (compacted !== snapshot || busySessions.get(sessionID) === true) {
          schedule(sessionID, true)
        }

        return { id: result.id, url: result.url, expiresAt: result.expiresAt }
      },
      unshare: async (input) => {
        const { sessionID } = input as { sessionID: string }
        return unshare(sessionID)
      },
    })

    const loadShares = async () => {
      const current = configuredEndpoint()
      if (!current) return
      const items = await scanStoredShares()
      for (const item of items) {
        const endpoint = storedEndpoint(item.stored, current)
        if (!sameEndpoint(endpoint, current)) continue
        if (item.stored.expiresAt <= Date.now()) {
          try {
            await ctx.storage.remove(item.key)
          } catch {}
          continue
        }

        // Migrate legacy directory-only keys to endpoint-scoped keys so two
        // servers can keep independent shares for the same session.
        const storageKey = shareKey(endpoint, item.directory, item.sessionID)
        if (storageKey !== item.key) {
          await ctx.storage.set(storageKey, item.stored)
          await ctx.storage.remove(item.key).catch(() => {})
        }
        shares.set(item.sessionID, {
          ...item.stored,
          directory: item.directory,
          sessionID: item.sessionID,
          storageKey,
          dirty: false,
          syncing: false,
        })
      }
    }

    await loadShares()

    // The plugin event stream is live-only, so a reload mid-turn never sees
    // execution.started. Read the persisted busy marker instead of inferring
    // the state from incomplete messages.
    const hydrateRunning = async () => {
      await Promise.all(
        [...shares.keys()].map(async (sessionID) => {
          const info = await ctx.session.get({ sessionID }).catch(() => undefined)
          const running = persistedRunning(info)
          if (running === true) {
            busySessions.set(sessionID, true)
            schedule(sessionID, true)
          } else if (running === false) {
            // Correct a share that was last uploaded while a turn was running
            // but has since gone idle.
            busySessions.delete(sessionID)
            schedule(sessionID, true)
          }
        }),
      )
    }

    await hydrateRunning()

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            if (!RELEVANT_EVENTS.has(event.type)) continue
            const data = event.data as Record<string, unknown> | undefined
            const sessionID =
              (typeof data?.sessionID === "string" && data.sessionID) ||
              (typeof (data?.info as Record<string, unknown> | undefined)?.id === "string"
                ? ((data?.info as Record<string, unknown>).id as string)
                : undefined)
            if (!sessionID) continue

            const running = executionRunning(event.type)
            if (running !== undefined) {
              // Keep true entries for unshared sessions so a share created
              // mid-turn inherits them; drop false entries so the map does not
              // grow with every session that has ever run.
              if (running || shares.has(sessionID)) busySessions.set(sessionID, running)
              else busySessions.delete(sessionID)

              const state = shares.get(sessionID)
              if (state) {
                state.lastEventAt = Date.now()
                schedule(sessionID, true)
              }
              continue
            }

            if (event.type === "session.deleted") {
              busySessions.delete(sessionID)
              if (shares.has(sessionID)) void unshare(sessionID).catch(() => {})
              continue
            }

            const state = shares.get(sessionID)
            if (!state) continue
            state.lastEventAt = Date.now()
            schedule(sessionID, event.type === "session.idle")
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn("session-share event stream ended", error)
        }
        if (controller.signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await hydrateRunning()

        // One-time catch-up after reconnect, only for shares that were active
        // shortly before the disconnect. Idle shares are never polled.
        const cutoff = Date.now() - 10 * 60_000
        for (const [sessionID, state] of shares) {
          if (state.lastEventAt && state.lastEventAt >= cutoff) schedule(sessionID)
        }
      }
    })()

    // Intentionally no heartbeat. Sync is event-driven; an idle session never
    // uploads. The reconnect path above performs a one-time catch-up for shares
    // that were recently active. Revisit only if OpenCode's event stream proves
    // lossy or half-open. This timer only removes expired local metadata.
    const expiryTimer = setInterval(() => {
      const current = Date.now()
      for (const [sessionID, state] of shares) {
        if (state.expiresAt <= current) void forgetShare(sessionID, state.directory)
      }
    }, 60_000)
    expiryTimer.unref?.()

    return async () => {
      controller.abort()
      clearInterval(expiryTimer)
      for (const sessionID of [...shares.keys()]) stopState(sessionID)
      await registration.dispose()
    }
  },
})
