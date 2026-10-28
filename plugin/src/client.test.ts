import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import type { ShareSnapshot } from "./types"
import { createShare, syncShare, type PluginOptions } from "./client"

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
  return JSON.parse(gunzipSync(Buffer.from(body)).toString("utf8")) as { snapshot: ShareSnapshot }
}

beforeEach(() => {
  captured = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init: init ?? {} }
    return new Response(
      JSON.stringify({
        id: "share_1",
        url: "https://example.test/s/share_1",
        secret: "sync-secret",
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
  test("createShare gzips the snapshot body", async () => {
    const result = await createShare(snapshot, options)
    expect(result.id).toBe("share_1")
    expect(captured?.url).toBe("https://example.test/api/shares")

    const headers = new Headers(captured?.init.headers)
    expect(headers.get("content-encoding")).toBe("gzip")
    expect(bodyJson(captured!.init).snapshot.title).toBe("Test")
  })

  test("syncShare gzips the snapshot and keeps the share secret", async () => {
    await syncShare("share_1", "sync-secret", snapshot, options)
    expect(captured?.url).toBe("https://example.test/api/shares/share_1/sync")

    const headers = new Headers(captured?.init.headers)
    expect(headers.get("content-encoding")).toBe("gzip")
    expect(headers.get("x-share-secret")).toBe("sync-secret")
    expect(bodyJson(captured!.init).snapshot.messages).toHaveLength(1)
  })

  test("requires an explicit endpoint", async () => {
    await expect(createShare(snapshot, { key: options.key })).rejects.toThrow(
      /missing endpoint/,
    )
  })

  test("rejects an incompatible service API version", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "x-share-api-version": "2" },
      })) as unknown as typeof fetch

    await expect(createShare(snapshot, options)).rejects.toThrow(/API version/)
  })
})
