import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto"

export const SYNC_CLOCK_SKEW_MS = 5 * 60_000
export const SYNC_NONCE_TTL_MS = 10 * 60_000

export function sha256Hex(data: string | Uint8Array) {
  return createHash("sha256").update(data).digest("hex")
}

export function parsePublicKey(value: unknown): KeyObject | null {
  if (typeof value !== "string" || value.length < 32 || value.length > 256) return null
  try {
    return createPublicKey({
      key: Buffer.from(value, "base64url"),
      format: "der",
      type: "spki",
    })
  } catch {
    return null
  }
}

export function syncSignatureMessage(
  path: string,
  timestamp: string | number,
  nonce: string,
  bodyHash: string,
) {
  return `POST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
}

export function verifySignature(
  publicKey: KeyObject,
  signature: string | undefined,
  message: string,
) {
  if (!signature) return false
  try {
    return verify(
      null,
      Buffer.from(message),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
  } catch {
    return false
  }
}
