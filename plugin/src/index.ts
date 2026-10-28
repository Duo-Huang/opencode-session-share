import { Plugin } from "@opencode/plugin"
import { compactForUpload } from "./compact"
import { SessionShareRpc } from "./rpc"
import {
  createShare,
  endpoint,
  prepareShare,
  revokeBySession,
  syncShare,
  type PluginOptions,
  type ShareMeta,
} from "./client"
import { normalizeSession } from "./normalize"
import { parseShareKey, shareKey, SHARE_PREFIX } from "./storage"

type StoredShare = ShareMeta & {
  secret: string
  directory: string
  /** Base URL of the service that owns this share. */
  endpoint?: string
}

type Watcher = {
  sessionID: string
  directory: string
  shareID: string
  secret: string
  timer?: ReturnType<typeof setTimeout>
  dirty: boolean
  running: boolean
}

const SHARE_CONSENT_KEY = "share_consent"

export default Plugin.define({
  id: "opencode-session-share",
  async setup(ctx) {
    const pluginOptions = ctx.options as PluginOptions
    const watchers = new Map<string, Watcher>()
    const controller = new AbortController()
    let heartbeat: ReturnType<typeof setInterval> | undefined

    type StoredShareItem = {
      key: string
      sessionID: string
      directory: string
      stored: StoredShare
    }

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

    const scanStoredShares = async () => {
      const shares: StoredShareItem[] = []
      let after: string | undefined

      // A share can be created from any directory (including the user's home)
      // and the TUI may restart in a different project directory. Scan all
      // share keys instead of only ctx.location.directory.
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await ctx.storage.scan({ prefix: SHARE_PREFIX, limit: 200, after })
        for (const entry of page.entries) {
          const parsed = parseShareKey(entry.key)
          if (!parsed) continue
          const stored = entry.value as StoredShare | undefined
          if (!stored?.id || !stored.secret || !stored.url) continue
          shares.push({
            key: entry.key,
            sessionID: parsed.sessionID,
            directory: stored.directory ?? parsed.directory,
            stored,
          })
        }
        if (!page.next || page.next === after) break
        after = page.next
      }
      return shares
    }

    const findStoredShare = async (sessionID: string) => {
      const current = configuredEndpoint()
      if (!current) return undefined
      return (await scanStoredShares()).find(
        (item) =>
          item.sessionID === sessionID &&
          sameEndpoint(storedEndpoint(item.stored, current), current),
      )
    }

    const readSnapshot = async (sessionID: string) => {
      const info = await ctx.session.get({ sessionID })
      const messages = (await ctx.session.context({ sessionID })) as readonly any[]
      return normalizeSession(ctx.app, ctx.location, info, messages)
    }

    const stopWatcher = (sessionID: string) => {
      const watcher = watchers.get(sessionID)
      if (!watcher) return
      if (watcher.timer) clearTimeout(watcher.timer)
      watchers.delete(sessionID)
    }

    const forgetShare = async (sessionID: string, directory: string) => {
      stopWatcher(sessionID)
      const stored = await findStoredShare(sessionID)
      await ctx.storage.remove(stored?.key ?? shareKey(directory, sessionID))
    }

    const flush = async (sessionID: string) => {
      const watcher = watchers.get(sessionID)
      if (!watcher) return
      if (watcher.running) {
        watcher.dirty = true
        return
      }
      if (watcher.timer) {
        clearTimeout(watcher.timer)
        watcher.timer = undefined
      }
      watcher.running = true
      watcher.dirty = false
      try {
        const snapshot = await readSnapshot(sessionID)
        await syncShare(watcher.shareID, watcher.secret, snapshot, pluginOptions)
      } catch (error) {
        const status = (error as Error & { status?: number }).status
        if (status === 410 || status === 404) {
          await forgetShare(sessionID, watcher.directory)
          return
        }
        console.warn("session-share sync failed", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        const current = watchers.get(sessionID)
        if (current) {
          current.timer = setTimeout(() => void flush(sessionID), 3000)
          current.timer.unref?.()
        }
      } finally {
        watcher.running = false
        if (watcher.dirty) {
          watcher.dirty = false
          void flush(sessionID)
        }
      }
    }

    const schedule = (sessionID: string, immediate = false) => {
      const watcher = watchers.get(sessionID)
      if (!watcher) return
      if (immediate) {
        void flush(sessionID)
        return
      }
      if (watcher.timer) return
      watcher.timer = setTimeout(() => void flush(sessionID), 1000)
      watcher.timer.unref?.()
    }

    const startWatcher = (sessionID: string, stored: StoredShare, immediate = false) => {
      stopWatcher(sessionID)
      watchers.set(sessionID, {
        sessionID,
        directory: stored.directory,
        shareID: stored.id,
        secret: stored.secret,
        dirty: false,
        running: false,
      })
      if (immediate) schedule(sessionID, true)
    }

    const rememberShare = async (sessionID: string, share: StoredShare, immediate = false) => {
      const current = configuredEndpoint()
      const { endpoint: existing, ...rest } = share
      const stored: StoredShare = {
        ...rest,
        ...(existing || current ? { endpoint: existing ?? current } : {}),
      }
      await ctx.storage.set(shareKey(stored.directory, sessionID), stored)
      startWatcher(sessionID, stored, immediate)
    }

    const unshare = async (sessionID: string) => {
      const watcher = watchers.get(sessionID)
      const stored = await findStoredShare(sessionID)
      const key =
        stored?.key ??
        shareKey(watcher?.directory ?? ctx.location.directory, sessionID)
      stopWatcher(sessionID)

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

        // Keep the share alive locally so the user can retry /unshare.
        if (stored && stored.stored.expiresAt > Date.now()) {
          startWatcher(
            sessionID,
            { ...stored.stored, directory: stored.directory },
            false,
          )
        }
        throw error
      }
    }

    const registration = await ctx.rpc.register(SessionShareRpc, {
      prepareShare: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const found = await findStoredShare(sessionID)
        if (found && found.stored.expiresAt > Date.now()) {
          if (!watchers.has(sessionID)) {
            startWatcher(sessionID, { ...found.stored, directory: found.directory }, false)
          }
          // Existing share: answer from local storage immediately; verify in the
          // background so a remote /unshare eventually clears the stale entry.
          void prepareShare(sessionID, pluginOptions)
            .then((existing) => {
              if (!existing) return forgetShare(sessionID, found.directory)
            })
            .catch(() => {})
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
          // The local sync secret is still available even though the stored
          // expiry has passed; syncing will refresh it.
          startWatcher(sessionID, { ...found.stored, directory: found.directory }, false)
          return { consentRequired: false, share: existing }
        }
        // A remote share without its local sync secret cannot be updated. The
        // next createShare call updates the same server-side share and returns
        // a fresh secret, so ask for consent and let the caller recreate it.
        return { consentRequired: !consent, share: null }
      },
      share: async (input) => {
        const { sessionID, consent } = input as { sessionID: string; consent?: boolean }
        const existing = await prepareShare(sessionID, pluginOptions)
        const found = await findStoredShare(sessionID)
        if (existing && found) {
          startWatcher(
            sessionID,
            { ...found.stored, directory: found.directory },
            true,
          )
          return existing
        }

        // If a remote share exists without its local sync secret, fall through:
        // createShare updates the same server-side share and returns a fresh
        // secret.
        const allowed = (await ctx.storage.get(SHARE_CONSENT_KEY)) === true || consent === true
        if (!allowed) throw new Error("Share consent required")
        if (consent === true) await ctx.storage.set(SHARE_CONSENT_KEY, true)

        const snapshot = await readSnapshot(sessionID)
        if (!snapshot.messages.length) {
          throw new Error("Session has no shareable messages yet")
        }
        // Create quickly with a bounded snapshot; the watcher immediately
        // syncs the full snapshot in the background.
        const result = await createShare(compactForUpload(snapshot), pluginOptions)
        const stored: StoredShare = {
          id: result.id,
          url: result.url,
          secret: result.secret,
          expiresAt: result.expiresAt,
          directory: ctx.location.directory,
          endpoint: configuredEndpoint() || undefined,
        }
        await rememberShare(sessionID, stored, true)
        return { id: result.id, url: result.url, expiresAt: result.expiresAt }
      },
      unshare: async (input) => {
        const { sessionID } = input as { sessionID: string }
        return unshare(sessionID)
      },
    })

    const resume = async () => {
      const current = configuredEndpoint()
      if (!current) return
      const shares = await scanStoredShares()
      for (const item of shares) {
        if (!sameEndpoint(storedEndpoint(item.stored, current), current)) continue
        startWatcher(
          item.sessionID,
          { ...item.stored, directory: item.directory },
          true,
        )
      }
    }

    void resume().catch((error) => {
      console.warn("session-share resume failed", error)
    })

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            const data = event.data as Record<string, unknown> | undefined
            const sessionID =
              (typeof data?.sessionID === "string" && data.sessionID) ||
              (typeof (data?.info as Record<string, unknown> | undefined)?.id === "string"
                ? ((data?.info as Record<string, unknown>).id as string)
                : undefined)
            if (!sessionID) continue

            if (event.type === "session.deleted") {
              if (watchers.has(sessionID)) void unshare(sessionID).catch(() => {})
              continue
            }
            if (!watchers.has(sessionID)) continue
            schedule(sessionID, event.type === "session.idle")
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn("session-share event stream ended", error)
        }
        if (controller.signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    })()

    // Event delivery is best-effort. A periodic flush guarantees that a lost
    // stream cannot leave a share frozen indefinitely.
    heartbeat = setInterval(() => {
      for (const sessionID of watchers.keys()) schedule(sessionID)
    }, 60_000)
    heartbeat.unref?.()

    return async () => {
      controller.abort()
      if (heartbeat) clearInterval(heartbeat)
      for (const sessionID of [...watchers.keys()]) stopWatcher(sessionID)
      await registration.dispose()
    }
  },
})
