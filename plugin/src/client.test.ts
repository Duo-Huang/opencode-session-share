import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash, createPublicKey, verify } from "node:crypto"
import { gunzipSync } from "node:zlib"
import type { ShareSnapshot } from "./types"
import {
  createShare,
  generateShareKeyPair,
  syncShare,
  type PluginOptions,
} from "./client"

const snapshot: ShareSnapshot = {
  v: 1,
  title: "Test",
  createdAt: 1,
  source: { app: "opencode", version: "2.1.4" },
  session: { id: "ses_1" },
  messages: [{ role: "user", time: 1, text: "hello" }],
}

let captured: { url: string; init: RequestInit } | null = null
const originalFetch = globalThis.fetch
const options: PluginOptions = {
  endpoint: "https://example.test",
  keyId: "test",
  key: "0123456789abcdef0123456789abcdef",
}

function bodyJson(init: RequestInit) {
  const body = init.body as Uint8Array
  return JSON.parse(gunzipSync(Buffer.from(body)).toString("utf8")) as {
    snapshot: ShareSnapshot
    publicKey?: string
  }
}

beforeEach(() => {
  captured = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init: init ?? {} }
    return new Response(
      JSON.stringify({
        id: "share_1",
        url: "https://example.test/s/share_1",
        updated: false,
        expiresAt: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("plugin HTTP client", () => {
  test("createShare gzips the snapshot and sends the public key", async () => {
    const pair = generateShareKeyPair()
    const result = await createShare(snapshot, pair.publicKey, options)
    expect(result.id).toBe("share_1")
    expect(captured?.url).toBe("https://example.test/api/shares")

    const headers = new Headers(captured?.init.headers)
    expect(headers.get("content-encoding")).toBe("gzip")
    expect(headers.get("authorization")).toBe(`Bearer ${options.key}`)
    const body = bodyJson(captured!.init)
    expect(body.snapshot.title).toBe("Test")
    expect(body.publicKey).toBe(pair.publicKey)
  })

  test("syncShare signs the body and does not send the API key or secret", async () => {
    const pair = generateShareKeyPair()
    await syncShare("share_1", pair.privateKey, snapshot, options)
    expect(captured?.url).toBe("https://example.test/api/shares/share_1/sync")

    const headers = new Headers(captured?.init.headers)
    expect(headers.get("content-encoding")).toBe("gzip")
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-share-key-id")).toBeNull()
    expect(headers.get("x-share-secret")).toBeNull()

    const timestamp = headers.get("x-share-timestamp")
    const nonce = headers.get("x-share-nonce")
    const signature = headers.get("x-share-signature")
    expect(timestamp).toMatch(/^\d{13}$/)
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{8,}$/)
    expect(signature).toBeTruthy()

    const body = bodyJson(captured!.init)
    expect(body.snapshot.messages).toHaveLength(1)
    const bodyHash = createHash("sha256")
      .update(JSON.stringify({ snapshot }))
      .digest("hex")
    const message = `POST\n/api/shares/share_1/sync\n${timestamp}\n${nonce}\n${bodyHash}`
    const publicKey = createPublicKey({
      key: Buffer.from(pair.publicKey, "base64url"),
      format: "der",
      type: "spki",
    })
    expect(
      verify(
        null,
        Buffer.from(message),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true)
  })

  test("requires an explicit endpoint", async () => {
    await expect(createShare(snapshot, "pk", { key: options.key })).rejects.toThrow(
      /missing endpoint/,
    )
  })

  test("rejects an incompatible service API version", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "x-share-api-version": "4" },
      })) as unknown as typeof fetch

    await expect(createShare(snapshot, "pk", options)).rejects.toThrow(/API version/)
  })
})
