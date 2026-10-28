import { z } from "zod"

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1")

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(47821),
  SHARE_KEYS: z.string().min(1),
  SHARE_SESSION_SALT: z.string().min(16),
  SHARE_PUBLIC_BASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
      message: "SHARE_PUBLIC_BASE_URL must use http:// or https://",
    }),
  SHARE_DEFAULT_TTL_DAYS: z.coerce.number().min(1).max(365).default(1),
  SHARE_MAX_TTL_DAYS: z.coerce.number().min(0).max(365).default(30),
  SHARE_MAX_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(15 * 1024 * 1024),
  SHARE_VIEW_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(10 * 1024 * 1024)
    .default(128 * 1024),
  SHARE_DB_MAX_MB: z.coerce.number().int().min(16).default(1024),
  SHARE_TRACK_VIEWS: bool,
  CF_ZONE_ID: z.string().optional(),
  CF_CACHE_PURGE_TOKEN: z.string().optional(),
  SHARE_PURGE_DISABLED: bool,
})

export type ShareKey = {
  id: string
  secret: string
}

export type Config = {
  port: number
  keys: ShareKey[]
  sessionSalt: string
  publicBaseUrl: string
  defaultTtlMs: number
  maxTtlMs: number
  maxBytes: number
  viewMaxBytes: number
  dbMaxBytes: number
  trackViews: boolean
  cfZoneId?: string
  cfCachePurgeToken?: string
  purgeDisabled: boolean
  /** Only cache the public API at the edge when purge is available. */
  edgeCache: boolean
}

function parseKeys(raw: string): ShareKey[] {
  const keys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf(":")
      if (index <= 0) throw new Error(`Invalid SHARE_KEYS entry: ${entry}`)
      const id = entry.slice(0, index).trim()
      const secret = entry.slice(index + 1).trim()
      if (!id || secret.length < 16) throw new Error(`Invalid SHARE_KEYS entry for ${id}`)
      return { id, secret }
    })

  if (keys.length === 0) throw new Error("SHARE_KEYS must contain at least one key")
  const ids = new Set<string>()
  for (const key of keys) {
    if (ids.has(key.id)) throw new Error(`Duplicate SHARE_KEYS id: ${key.id}`)
    ids.add(key.id)
  }
  return keys
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.parse(env)
  const base = parsed.SHARE_PUBLIC_BASE_URL.replace(/\/+$/, "")
  const defaultTtlDays = Math.min(parsed.SHARE_DEFAULT_TTL_DAYS, parsed.SHARE_MAX_TTL_DAYS)
  const cfZoneId = parsed.CF_ZONE_ID || undefined
  const cfCachePurgeToken = parsed.CF_CACHE_PURGE_TOKEN || undefined
  return {
    port: parsed.PORT,
    keys: parseKeys(parsed.SHARE_KEYS),
    sessionSalt: parsed.SHARE_SESSION_SALT,
    publicBaseUrl: base,
    defaultTtlMs: defaultTtlDays * 86400_000,
    maxTtlMs: parsed.SHARE_MAX_TTL_DAYS * 86400_000,
    maxBytes: parsed.SHARE_MAX_BYTES,
    viewMaxBytes: parsed.SHARE_VIEW_MAX_BYTES,
    dbMaxBytes: parsed.SHARE_DB_MAX_MB * 1024 * 1024,
    trackViews: parsed.SHARE_TRACK_VIEWS,
    cfZoneId,
    cfCachePurgeToken,
    purgeDisabled: parsed.SHARE_PURGE_DISABLED,
    edgeCache: Boolean(cfZoneId && cfCachePurgeToken && !parsed.SHARE_PURGE_DISABLED),
  }
}

export const config = loadConfig()
