import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import {
  parsePublicKey,
  sha256Hex,
  syncSignatureMessage,
  verifySignature,
} from "./signature"

describe("sync signatures", () => {
  test("accepts an Ed25519 signature over the canonical message", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const publicKeyText = publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url")
    const parsed = parsePublicKey(publicKeyText)
    expect(parsed).not.toBeNull()

    const bodyHash = sha256Hex('{"snapshot":{"v":1}}')
    const message = syncSignatureMessage(
      "/api/shares/share_1/sync",
      "1794114211000",
      "nonce_12345678",
      bodyHash,
    )
    const signature = sign(null, Buffer.from(message), privateKey).toString("base64url")

    expect(verifySignature(parsed!, signature, message)).toBe(true)
    expect(verifySignature(parsed!, signature, `${message}\n`)).toBe(false)
  })

  test("rejects malformed public keys", () => {
    expect(parsePublicKey("")).toBeNull()
    expect(parsePublicKey("not-a-key")).toBeNull()
    expect(parsePublicKey(123)).toBeNull()
  })
})
