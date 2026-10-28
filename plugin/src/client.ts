import { gzipSync } from "node:zlib"
import type { ShareSnapshot } from "./types"

export type PluginOptions = {
  endpoint?: string
  keyId?: string
  key?: string
}

export type ShareMeta = {
  id: string
  url: string
  expiresAt: number
  updatedAt?: number
}

export type CreateResult = ShareMeta & {
  secret: string
  updated: boolean
}

/** Keep this in sync with the service's SHARE_API_VERSION. */
export const SHARE_API_VERSION = "1"
const REQUEST_TIMEOUT_MS = 120_000
const USER_AGENT = "opencode-session-share-plugin"

function env(name: string) {
  return (globalThis as any).process?.env?.[name] as string | undefined
}

export function endpoint(options: PluginOptions = {}) {
  const raw = (options.endpoint ?? env("OPENCODE_SHARE_ENDPOINT") ?? "").trim()
  if (!raw) {
    throw new Error(
      "session-share: missing endpoint. Set the plugin endpoint option or OPENCODE_SHARE_ENDPOINT.",
    )
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`session-share: invalid endpoint: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("session-share: endpoint must use http:// or https://")
  }
  return url.toString().replace(/\/+$/, "")
}

export function credentials(options: PluginOptions = {}) {
  const keyId = String(options.keyId ?? env("OPENCODE_SHARE_KEY_ID") ?? "")
  const key = String(options.key ?? env("OPENCODE_SHARE_KEY") ?? "")
  return { keyId, key }
}

function gzipJson(value: unknown) {
  return gzipSync(Buffer.from(JSON.stringify(value)))
}

async function request(path: string, init: RequestInit = {}, options: PluginOptions = {}) {
  const { keyId, key } = credentials(options)
  if (!key) {
    throw new Error(
      "session-share: missing key. Set the plugin key option or OPENCODE_SHARE_KEY.",
    )
  }

  const response = await fetch(`${endpoint(options)}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      authorization: `Bearer ${key}`,
      ...(keyId ? { "x-share-key-id": keyId } : {}),
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const apiVersion = response.headers.get("x-share-api-version")
  if (apiVersion && apiVersion !== SHARE_API_VERSION) {
    throw new Error(
      `session-share: service API version ${apiVersion} is not supported (expected ${SHARE_API_VERSION}).`,
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    const error = new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }
  return response
}

export async function prepareShare(
  sessionID: string,
  options: PluginOptions = {},
): Promise<ShareMeta | null> {
  const response = await request(
    `/api/shares/by-session/${encodeURIComponent(sessionID)}`,
    {},
    options,
  )
  const data = (await response.json()) as { share: ShareMeta | null }
  return data.share
}

export async function createShare(
  snapshot: ShareSnapshot,
  options: PluginOptions = {},
): Promise<CreateResult> {
  const response = await request(
    "/api/shares",
    {
      method: "POST",
      headers: { "content-encoding": "gzip" },
      body: gzipJson({ snapshot }),
    },
    options,
  )
  return (await response.json()) as CreateResult
}

export async function syncShare(
  id: string,
  secret: string,
  snapshot: ShareSnapshot,
  options: PluginOptions = {},
) {
  const response = await request(
    `/api/shares/${encodeURIComponent(id)}/sync`,
    {
      method: "POST",
      headers: { "x-share-secret": secret, "content-encoding": "gzip" },
      body: gzipJson({ snapshot }),
    },
    options,
  )
  return (await response.json()) as { ok: boolean; changed: boolean }
}

export async function revokeBySession(sessionID: string, options: PluginOptions = {}) {
  const response = await request(
    "/api/shares/revoke",
    {
      method: "POST",
      body: JSON.stringify({ sessionID }),
    },
    options,
  )
  return (await response.json()) as { revoked: boolean; cachePurge?: string }
}

export async function revokeById(id: string, options: PluginOptions = {}) {
  const response = await request(
    `/api/shares/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    options,
  )
  return (await response.json()) as { revoked: boolean; cachePurge?: string }
}
