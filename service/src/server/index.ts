import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { compress } from "hono/compress"
import { serveStatic } from "hono/bun"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import { config } from "./config"
import { authenticate, hashSecret, verifySecret } from "./auth"
import {
  checkpoint,
  db,
  dbSize,
  deleteOldTombstones,
  expireShare,
  findActiveBySessionKey,
  findAnyActiveBySessionKey,
  findById,
  randomShareId,
  randomSyncSecret,
  sessionKey,
  vacuum,
  type ShareRow,
} from "./db"
import {
  ShareSnapshotSchema,
  buildLiveView,
  buildPageView,
  buildShareView,
  searchSnapshot,
  stripSessionId,
  type ValidShareSnapshot,
} from "./payload"
import { rateLimit } from "./ratelimit"
import { processPurgeQueue, purgeNow } from "./cloudflare"
import {
  broadcastUpdate,
  closeAllLive,
  registerLiveRoutes,
  revokeLive,
  websocket,
} from "./live"
import {
  errorPage,
  escapeHtml,
  goneHeaders,
  noStore,
  notFoundPage,
  publicApiHeaders,
  shellHeaders,
} from "./render"

const app = new Hono()
const SHARE_API_VERSION = "1"
const viewerDir = join(import.meta.dir, "../../dist/viewer")
const viewerIndex = join(viewerDir, "index.html")
const revokedIds = new Map<string, number>()

let viewerHtmlCache: string | undefined
function readViewerHtml() {
  if (viewerHtmlCache === undefined) viewerHtmlCache = readFileSync(viewerIndex, "utf8")
  return viewerHtmlCache
}

async function readJsonBody(c: Context) {
  const encoding = c.req.header("content-encoding") ?? ""
  if (encoding.toLowerCase().includes("gzip")) {
    const raw = Buffer.from(await c.req.arrayBuffer())
    try {
      return JSON.parse(gunzipSync(raw).toString("utf8"))
    } catch {
      // Cloudflare may decompress the request but leave the header in place.
      return JSON.parse(raw.toString("utf8"))
    }
  }
  return c.req.json()
}

function now() {
  return Date.now()
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function publicUrl(id: string) {
  return `${config.publicBaseUrl}/s/${id}`
}

function apiUrl(id: string) {
  return `${config.publicBaseUrl}/api/public/shares/${id}`
}

function cacheUrls(id: string) {
  return [apiUrl(id), publicUrl(id)]
}

async function fetchForWarmup(url: string, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "opencode-session-share/warmup" },
        signal: AbortSignal.timeout(180_000),
      })
      await response.arrayBuffer()
      return
    } catch (error) {
      if (attempt === attempts) {
        console.warn("cache warmup failed", { url, attempts, error: String(error) })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
}

async function warmCache(id: string) {
  const urls = config.edgeCache ? [publicUrl(id), apiUrl(id)] : [publicUrl(id)]
  await Promise.allSettled(urls.map(fetchForWarmup))
}

/**
 * Hashed viewer assets are immutable and cached at the edge for a year, but a
 * fresh deploy introduces new filenames. Warm them in the background so the
 * first viewer does not have to pull the JS/CSS through the slow Tunnel.
 */
async function warmViewerAssets() {
  try {
    const html = readViewerHtml()
    const assets = [...new Set(html.match(/\/assets\/[^"' ]+/g) ?? [])]
    await Promise.allSettled(assets.map((asset) => fetchForWarmup(`${config.publicBaseUrl}${asset}`)))
  } catch (error) {
    console.warn("viewer asset warmup skipped", error)
  }
}

function clientIp(c: Parameters<typeof app.request>[0] | any) {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}

function ttlMs(input: unknown) {
  const seconds =
    typeof input === "number" && Number.isFinite(input) ? Math.round(input) : config.defaultTtlMs / 1000
  const clamped = Math.max(60, Math.min(seconds, config.maxTtlMs / 1000))
  return clamped * 1000
}

function readSnapshot(row: ShareRow): ValidShareSnapshot | null {
  if (!row.payload) return null
  try {
    const text =
      row.payload_encoding === "gzip"
        ? gunzipSync(row.payload).toString("utf8")
        : new TextDecoder().decode(row.payload)
    return ShareSnapshotSchema.parse(JSON.parse(text))
  } catch (error) {
    console.error("failed to read share snapshot", { id: row.id, error })
    return null
  }
}

function publicPayload(row: ShareRow) {
  const snapshot = readSnapshot(row)
  if (!snapshot) return null
  const view = buildShareView(snapshot, config.viewMaxBytes)
  return {
    ...snapshot,
    messages: view.messages,
    page: {
      start: view.start,
      end: view.end,
      total: view.total,
      hasBefore: view.hasBefore,
      hasAfter: view.hasAfter,
    },
    index: view.index,
    privacy: view.privacy,
    stats: view.stats,
    id: row.id,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

function pagePayload(
  row: ShareRow,
  cursor: { start?: number; before?: number },
) {
  const snapshot = readSnapshot(row)
  if (!snapshot) return null
  const view = buildPageView(snapshot, config.viewMaxBytes, cursor)
  return {
    messages: view.messages,
    page: {
      start: view.start,
      end: view.end,
      total: view.total,
      hasBefore: view.hasBefore,
      hasAfter: view.hasAfter,
    },
    privacy: view.privacy,
    updatedAt: row.updated_at,
  }
}

function livePayload(
  snapshot: ValidShareSnapshot,
  id: string,
  updatedAt: number,
  expiresAt: number,
) {
  const view = buildLiveView(snapshot)
  return {
    id,
    updatedAt,
    expiresAt,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    source: snapshot.source,
    session: snapshot.session,
    stats: view.stats,
    index: view.index,
    privacy: view.privacy,
    total: view.total,
  }
}

async function revokeShare(id: string) {
  const row = findById(id)
  if (!row) return { revoked: false, id, cachePurge: "skipped" as const }
  if (row.revoked_at) return { revoked: false, id, cachePurge: "skipped" as const }

  revokedIds.set(id, now())
  expireShare(id, now())
  checkpoint()
  revokeLive(id)

  const purge = await purgeNow(cacheUrls(id))
  const cachePurge = purge === "ok" ? "ok" : purge === "disabled" ? "disabled" : "queued"
  return { revoked: true, id, cachePurge }
}

app.use("*", async (c, next) => {
  await next()
  // These routes set their own cache policy.
  if (
    c.req.path.startsWith("/assets/") ||
    c.req.path.startsWith("/s/") ||
    c.req.path.startsWith("/api/public/shares/") ||
    c.req.path === "/robots.txt"
  ) {
    return
  }
  for (const [key, value] of Object.entries(noStore())) c.header(key, value)
})

app.use(compress())

app.use(
  "/api/*",
  bodyLimit({
    maxSize: config.maxBytes,
    onError: (c) =>
      c.json({ error: "payload_too_large", requestId: c.get("requestId") }, 413, noStore()),
  }),
)

app.use(
  "/assets/*",
  serveStatic({
    root: viewerDir,
    onFound: (_path, c) => {
      c.header("cache-control", "public, max-age=31536000, immutable")
    },
  }),
)

app.get("/robots.txt", (c) => {
  c.header("content-type", "text/plain; charset=utf-8")
  c.header("cache-control", "public, max-age=86400")
  return c.body("User-agent: *\nDisallow: /\n")
})

app.use("/api/*", async (c, next) => {
  await next()
  c.header("x-share-api-version", SHARE_API_VERSION)
})

app.get("/healthz", (c) => {
  try {
    db.query("SELECT 1").get()
    return c.json(
      {
        ok: true,
        apiVersion: SHARE_API_VERSION,
        shares: db.query("SELECT COUNT(*) as count FROM shares").get(),
      },
      200,
      noStore(),
    )
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 503, noStore())
  }
})

app.get("/api/shares/by-session/:sessionID", async (c) => {
  const auth = authenticate(c)
  if (!auth) return c.json({ error: "unauthorized" }, 401, noStore())
  if (!rateLimit(`api:${auth.keyId}`, 600, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const sessionID = c.req.param("sessionID")
  const key = sessionKey(sessionID)
  const active = findActiveBySessionKey(key)
  if (active) {
    return c.json(
      {
        share: {
          id: active.id,
          url: publicUrl(active.id),
          expiresAt: active.expires_at,
          updatedAt: active.updated_at,
        },
      },
      200,
      noStore(),
    )
  }

  const stale = findAnyActiveBySessionKey(key)
  if (stale && stale.expires_at <= now()) await revokeShare(stale.id)
  return c.json({ share: null }, 200, noStore())
})

app.post("/api/shares", async (c) => {
  const auth = authenticate(c)
  if (!auth) return c.json({ error: "unauthorized" }, 401, noStore())
  if (!rateLimit(`api:${auth.keyId}`, 600, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  let body: unknown
  try {
    body = await readJsonBody(c)
  } catch {
    return c.json({ error: "invalid_json" }, 400, noStore())
  }

  const snapshotInput =
    body && typeof body === "object" && "snapshot" in body
      ? (body as { snapshot: unknown }).snapshot
      : body
  const parsed = ShareSnapshotSchema.safeParse(snapshotInput)
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_payload",
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
      noStore(),
    )
  }

  const snapshot = parsed.data
  if (!snapshot.session.id) {
    return c.json({ error: "invalid_payload", issues: [{ path: "session.id", message: "Required" }] }, 400, noStore())
  }
  const stored = stripSessionId(snapshot as ValidShareSnapshot)
  const storedRaw = JSON.stringify(stored)
  const compressed = gzipSync(Buffer.from(storedRaw), { level: 6 })
  const payloadHash = sha256(storedRaw)
  const key = sessionKey(snapshot.session.id)
  const current = now()
  const requestedTtl =
    body && typeof body === "object" && "ttlSeconds" in body
      ? (body as { ttlSeconds?: unknown }).ttlSeconds
      : undefined
  const expiresAt = current + ttlMs(requestedTtl)

  if (dbSize() > config.dbMaxBytes) {
    return c.json({ error: "storage_full" }, 507, noStore())
  }

  const stale = findAnyActiveBySessionKey(key)
  if (stale && stale.expires_at <= current) await revokeShare(stale.id)

  const existing = findActiveBySessionKey(key)
  const id = existing?.id ?? randomShareId()
  const syncSecret = randomSyncSecret()
  const secretHash = hashSecret(syncSecret)
  const version = (existing?.version ?? 0) + 1
  const compressedBytes = new Uint8Array(compressed)

  db.transaction(() => {
    if (existing) {
      db.run(
        `UPDATE shares
            SET key_id = ?, title = ?, payload = ?, payload_encoding = 'gzip',
                payload_hash = ?, sync_secret_hash = ?, size_bytes = ?,
                stored_bytes = ?, version = ?, updated_at = ?, last_sync_at = ?,
                expires_at = ?
          WHERE id = ?`,
        [
          auth.keyId,
          stored.title,
          compressedBytes,
          payloadHash,
          secretHash,
          Buffer.byteLength(storedRaw),
          compressed.byteLength,
          version,
          current,
          current,
          expiresAt,
          id,
        ],
      )
    } else {
      db.run(
        `INSERT INTO shares
          (id, session_key, key_id, title, payload, payload_encoding, payload_hash,
           sync_secret_hash, size_bytes, stored_bytes, version, created_at,
           updated_at, last_sync_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'gzip', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          key,
          auth.keyId,
          stored.title,
          compressedBytes,
          payloadHash,
          secretHash,
          Buffer.byteLength(storedRaw),
          compressed.byteLength,
          version,
          current,
          current,
          current,
          expiresAt,
        ],
      )
    }
  })()

  broadcastUpdate(id, livePayload(stored, id, current, expiresAt))
  if (existing) {
    void (async () => {
      const purged = await purgeNow(cacheUrls(id))
      if (purged === "ok" || purged === "disabled") await warmCache(id)
    })()
  } else {
    void warmCache(id)
  }

  return c.json(
    {
      id,
      url: publicUrl(id),
      secret: syncSecret,
      updated: !!existing,
      version,
      expiresAt,
    },
    200,
    noStore(),
  )
})

app.post("/api/shares/:id/sync", async (c) => {
  const auth = authenticate(c)
  if (!auth) return c.json({ error: "unauthorized" }, 401, noStore())

  const id = c.req.param("id")
  if (!rateLimit(`sync:${id}`, 4, 1000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const row = findById(id)
  if (!row || row.revoked_at) return c.json({ error: "not_found" }, 410, noStore())
  if (row.expires_at <= now()) {
    await revokeShare(id)
    return c.json({ error: "expired" }, 410, noStore())
  }
  if (!verifySecret(c.req.header("x-share-secret"), row.sync_secret_hash ?? "")) {
    return c.json({ error: "forbidden" }, 403, noStore())
  }

  let body: unknown
  try {
    body = await readJsonBody(c)
  } catch {
    return c.json({ error: "invalid_json" }, 400, noStore())
  }
  const snapshotInput =
    body && typeof body === "object" && "snapshot" in body
      ? (body as { snapshot: unknown }).snapshot
      : body
  const parsed = ShareSnapshotSchema.safeParse(snapshotInput)
  if (!parsed.success) {
    return c.json({ error: "invalid_payload" }, 400, noStore())
  }

  if (!parsed.data.session.id) {
    return c.json({ error: "invalid_payload" }, 400, noStore())
  }
  const stored = stripSessionId(parsed.data as ValidShareSnapshot)
  const storedRaw = JSON.stringify(stored)
  const payloadHash = sha256(storedRaw)
  if (payloadHash === row.payload_hash) {
    return c.json({ ok: true, changed: false }, 200, noStore())
  }

  const compressed = gzipSync(Buffer.from(storedRaw), { level: 6 })
  const current = now()
  const expiresAt = current + ttlMs(undefined)
  db.run(
    `UPDATE shares
        SET payload = ?, payload_encoding = 'gzip', payload_hash = ?,
            size_bytes = ?, stored_bytes = ?, updated_at = ?, last_sync_at = ?,
            expires_at = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [
      new Uint8Array(compressed),
      payloadHash,
      Buffer.byteLength(storedRaw),
      compressed.byteLength,
      current,
      current,
      expiresAt,
      id,
    ],
  )
  broadcastUpdate(id, livePayload(stored as ValidShareSnapshot, id, current, expiresAt))
  return c.json({ ok: true, changed: true }, 200, noStore())
})

app.post("/api/shares/revoke", async (c) => {
  const auth = authenticate(c)
  if (!auth) return c.json({ error: "unauthorized" }, 401, noStore())
  if (!rateLimit(`api:${auth.keyId}`, 600, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  let body: { sessionID?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "invalid_json" }, 400, noStore())
  }
  if (typeof body.sessionID !== "string" || !body.sessionID) {
    return c.json({ error: "invalid_session" }, 400, noStore())
  }

  const key = sessionKey(body.sessionID)
  const row = findAnyActiveBySessionKey(key)
  if (!row) return c.json({ revoked: false }, 200, noStore())
  const result = await revokeShare(row.id)
  return c.json(result, 200, noStore())
})

app.delete("/api/shares/:id", async (c) => {
  const auth = authenticate(c)
  if (!auth) return c.json({ error: "unauthorized" }, 401, noStore())
  if (!rateLimit(`api:${auth.keyId}`, 600, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }
  const result = await revokeShare(c.req.param("id"))
  return c.json(result, 200, noStore())
})

app.get("/api/public/shares/:id", async (c) => {
  const id = c.req.param("id")
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return c.json({ error: "not_found" }, 404, noStore())
  if (revokedIds.has(id)) return c.json({ error: "gone" }, 410, goneHeaders())

  if (!rateLimit(`public:${clientIp(c)}`, 120, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const row = findById(id)
  if (!row) return c.json({ error: "not_found" }, 404, noStore())
  if (row.revoked_at || row.expires_at <= now()) {
    if (!row.revoked_at) await revokeShare(id)
    return c.json({ error: "gone" }, 410, goneHeaders())
  }
  const payload = publicPayload(row)
  if (!payload) return c.json({ error: "invalid_snapshot" }, 500, noStore())
  if (config.trackViews) {
    db.run("UPDATE shares SET last_sync_at = last_sync_at WHERE id = ?", [id])
  }
  const fresh = c.req.query("fresh") !== undefined
  return c.json(payload, 200, fresh ? noStore() : publicApiHeaders(config.edgeCache))
})

app.get("/api/public/shares/:id/messages", async (c) => {
  const id = c.req.param("id")
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return c.json({ error: "not_found" }, 404, noStore())
  if (revokedIds.has(id)) return c.json({ error: "gone" }, 410, goneHeaders())
  if (!rateLimit(`public:${clientIp(c)}`, 120, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const row = findById(id)
  if (!row) return c.json({ error: "not_found" }, 404, noStore())
  if (row.revoked_at || row.expires_at <= now()) {
    if (!row.revoked_at) await revokeShare(id)
    return c.json({ error: "gone" }, 410, goneHeaders())
  }

  const startRaw = c.req.query("start")
  const beforeRaw = c.req.query("before")
  if (startRaw !== undefined && beforeRaw !== undefined) {
    return c.json({ error: "invalid_cursor" }, 400, noStore())
  }
  const start = startRaw === undefined ? undefined : Number(startRaw)
  const before = beforeRaw === undefined ? undefined : Number(beforeRaw)
  if (
    (start !== undefined && (!Number.isInteger(start) || start < 0)) ||
    (before !== undefined && (!Number.isInteger(before) || before < 0))
  ) {
    return c.json({ error: "invalid_cursor" }, 400, noStore())
  }

  const payload = pagePayload(row, { start, before })
  if (!payload) return c.json({ error: "invalid_snapshot" }, 500, noStore())
  return c.json(payload, 200, noStore())
})

app.get("/api/public/shares/:id/search", async (c) => {
  const id = c.req.param("id")
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return c.json({ error: "not_found" }, 404, noStore())
  if (revokedIds.has(id)) return c.json({ error: "gone" }, 410, goneHeaders())
  if (!rateLimit(`public-search:${clientIp(c)}`, 120, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const row = findById(id)
  if (!row) return c.json({ error: "not_found" }, 404, noStore())
  if (row.revoked_at || row.expires_at <= now()) {
    if (!row.revoked_at) await revokeShare(id)
    return c.json({ error: "gone" }, 410, goneHeaders())
  }

  const query = (c.req.query("q") ?? "").trim()
  if (!query || query.length > 200) {
    return c.json({ error: "invalid_query" }, 400, noStore())
  }
  const snapshot = readSnapshot(row)
  if (!snapshot) return c.json({ error: "invalid_snapshot" }, 500, noStore())
  return c.json(
    {
      query,
      total: snapshot.messages.length,
      results: searchSnapshot(snapshot, query),
    },
    200,
    noStore(),
  )
})

app.get("/api/public/shares/:id/parts/:messageIndex/:partIndex", async (c) => {
  const id = c.req.param("id")
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return c.json({ error: "not_found" }, 404, noStore())
  if (revokedIds.has(id)) return c.json({ error: "gone" }, 410, goneHeaders())

  if (!rateLimit(`public:${clientIp(c)}`, 120, 60_000)) {
    return c.json({ error: "rate_limited" }, 429, noStore())
  }

  const row = findById(id)
  if (!row) return c.json({ error: "not_found" }, 404, noStore())
  if (row.revoked_at || row.expires_at <= now()) {
    if (!row.revoked_at) await revokeShare(id)
    return c.json({ error: "gone" }, 410, goneHeaders())
  }

  const messageIndex = Number(c.req.param("messageIndex"))
  const partIndex = Number(c.req.param("partIndex"))
  if (
    !Number.isInteger(messageIndex) ||
    messageIndex < 0 ||
    !Number.isInteger(partIndex) ||
    partIndex < 0
  ) {
    return c.json({ error: "not_found" }, 404, noStore())
  }

  const snapshot = readSnapshot(row)
  if (!snapshot) return c.json({ error: "invalid_snapshot" }, 500, noStore())
  const message = snapshot.messages[messageIndex]
  if (!message || message.role !== "assistant") {
    return c.json({ error: "not_found" }, 404, noStore())
  }
  const part = message.content[partIndex]
  if (!part || (part.type !== "tool" && part.type !== "reasoning")) {
    return c.json({ error: "not_found" }, 404, noStore())
  }

  return c.json({ part }, 200, publicApiHeaders(config.edgeCache))
})

app.get("/s/:id", (c) => {
  const id = c.req.param("id")
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return c.html(notFoundPage(), 404, goneHeaders())
  // The shell is generic and safe to cache. The API and WebSocket enforce
  // revocation, so a cached shell can still show the revoked state.
  try {
    return c.html(readViewerHtml(), 200, shellHeaders())
  } catch (error) {
    console.error("viewer index missing", error)
    return c.html(errorPage("Viewer is not built"), 500, noStore())
  }
})

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404, noStore())
  return c.html(notFoundPage(), 404, goneHeaders())
})

app.onError((error, c) => {
  console.error("request failed", {
    path: c.req.path,
    error: error instanceof Error ? error.stack : String(error),
  })
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "internal_error" }, 500, noStore())
  }
  return c.html(errorPage(), 500, noStore())
})

registerLiveRoutes(app)

export function startServer() {
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: { ...websocket, perMessageDeflate: true },
    idleTimeout: 120,
  })

  void warmViewerAssets()

  let expiryRunning = false
  const expiryTimer = setInterval(() => {
    if (expiryRunning) return
    expiryRunning = true
    void (async () => {
      try {
        const current = now()
        const expired = db
          .query("SELECT id FROM shares WHERE revoked_at IS NULL AND expires_at <= ?")
          .all(current) as { id: string }[]
        for (const row of expired) {
          await revokeShare(row.id)
          console.log("share expired", row.id)
        }
        for (const [id, at] of revokedIds) {
          if (at < current - 30 * 86400_000) revokedIds.delete(id)
        }
        deleteOldTombstones(current - 30 * 86400_000)
        checkpoint()
      } finally {
        expiryRunning = false
      }
    })()
  }, 60_000)
  expiryTimer.unref()

  let purgeRunning = false
  const purgeTimer = setInterval(() => {
    if (purgeRunning) return
    purgeRunning = true
    void processPurgeQueue().finally(() => {
      purgeRunning = false
    })
  }, 10_000)
  purgeTimer.unref()

  const vacuumTimer = setInterval(() => {
    vacuum()
  }, 24 * 3600_000)
  vacuumTimer.unref()

  const shutdown = () => {
    closeAllLive()
    server.stop()
    db.close()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  console.log(
    JSON.stringify({
      level: "info",
      message: "opencode-session-share started",
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      ttlDays: config.defaultTtlMs / 86400_000,
      edgeCache: config.edgeCache,
      keys: config.keys.map((key) => key.id),
    }),
  )

  return server
}

if (import.meta.main) startServer()
