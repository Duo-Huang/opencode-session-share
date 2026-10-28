import { config } from "./config"
import { db } from "./db"

export type PurgeResult = "ok" | "failed" | "disabled"

type CloudflarePurgeResponse = {
  success?: boolean
  errors?: unknown
}

async function purgeUrls(urls: string[]): Promise<PurgeResult> {
  if (!config.edgeCache) return "disabled"
  if (urls.length === 0) return "ok"

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.cfZoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.cfCachePurgeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ files: urls }),
        signal: AbortSignal.timeout(5000),
      },
    )
    const payload = (await response.json().catch(() => null)) as CloudflarePurgeResponse | null
    if (!response.ok || payload?.success !== true) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload?.errors ?? null)}`)
    }
    return "ok"
  } catch (error) {
    console.warn("cloudflare purge failed", { urls, error: String(error) })
    return "failed"
  }
}

export function queuePurges(urls: string[]) {
  if (!config.edgeCache || urls.length === 0) return
  const now = Date.now()
  const insert = db.prepare(
    "INSERT INTO purge_queue (url, attempts, next_at, created_at) VALUES (?, 0, ?, ?)",
  )
  db.transaction(() => {
    for (const url of urls) insert.run(url, now, now)
  })()
}

/**
 * Purge exact URLs and return whether the edge cache was invalidated.
 * On failure the URLs are queued for retry; the short API edge TTL bounds
 * how long a stale response can survive if Cloudflare is unavailable.
 */
export async function purgeNow(urls: string[]): Promise<PurgeResult> {
  const result = await purgeUrls(urls)
  if (result === "failed") queuePurges(urls)
  return result
}

export async function processPurgeQueue() {
  if (!config.edgeCache) return

  const rows = db
    .query("SELECT id, url, attempts FROM purge_queue WHERE next_at <= ? ORDER BY id LIMIT 20")
    .all(Date.now()) as { id: number; url: string; attempts: number }[]
  if (rows.length === 0) return

  const result = await purgeUrls(rows.map((row) => row.url))
  if (result === "ok" || result === "disabled") {
    const ids = rows.map((row) => row.id)
    db.run(
      `DELETE FROM purge_queue WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    )
    return
  }

  for (const row of rows) {
    const attempts = row.attempts + 1
    if (attempts >= 10) {
      db.run("DELETE FROM purge_queue WHERE id = ?", [row.id])
      console.warn("cloudflare purge giving up", { url: row.url, attempts })
      continue
    }
    const delay = Math.min(60_000 * 2 ** attempts, 3_600_000)
    db.run(
      "UPDATE purge_queue SET attempts = ?, next_at = ? WHERE id = ?",
      [attempts, Date.now() + delay, row.id],
    )
  }
}
