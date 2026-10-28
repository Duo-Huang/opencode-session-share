import { createHash, timingSafeEqual } from "node:crypto"
import type { Context } from "hono"
import { config } from "./config"

const hashes = config.keys.map((key) => ({
  id: key.id,
  hash: createHash("sha256").update(key.secret).digest(),
}))

export type AuthResult = {
  keyId: string
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

export function authenticate(c: Context): AuthResult | null {
  const header = c.req.header("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!token) return null
  const got = sha256(token)
  const key = hashes.find((candidate) => {
    return candidate.hash.length === got.length && timingSafeEqual(candidate.hash, got)
  })
  if (!key) return null

  const keyId = c.req.header("x-share-key-id")
  if (keyId && keyId !== key.id) return null

  return { keyId: key.id }
}

export function hashSecret(secret: string) {
  return sha256(secret).toString("hex")
}

export function verifySecret(secret: string | undefined, hash: string) {
  if (!secret) return false
  const got = sha256(secret)
  const expected = Buffer.from(hash, "hex")
  return got.length === expected.length && timingSafeEqual(got, expected)
}
