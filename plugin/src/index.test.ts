import { afterEach, describe, expect, test } from "bun:test"
import { generateShareKeyPair } from "./client"
import plugin from "./index"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("lazy event-driven sync", () => {
  test("does not sync without a relevant event", async () => {
    originalFetch = globalThis.fetch
    const pair = generateShareKeyPair()
    const entries = new Map<string, unknown>([
      [
        "share:/work/a:ses_1",
        {
          id: "share_1",
          url: "https://example.test/s/share_1",
          expiresAt: Date.now() + 86_400_000,
          privateKey: pair.privateKey,
          directory: "/work/a",
          endpoint: "https://example.test",
        },
      ],
    ])
    const events: Array<{ type: string; data: unknown }> = []
    const fetches: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetches.push(String(input))
      return new Response(JSON.stringify({ ok: true, changed: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-share-api-version": "2",
        },
      })
    }) as typeof fetch

    const ctx = {
      options: {
        endpoint: "https://example.test",
        keyId: "test",
        key: "0123456789abcdef0123456789abcdef",
      },
      location: { directory: "/work/a" },
      app: { version: "2.2.5" },
      storage: {
        async scan({ prefix }: { prefix: string }) {
          return {
            entries: [...entries]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key, value })),
          }
        },
        async get() {
          return undefined
        },
        async set(key: string, value: unknown) {
          entries.set(key, value)
        },
        async remove(key: string) {
          entries.delete(key)
        },
      },
      session: {
        async get({ sessionID }: { sessionID: string }) {
          return {
            id: sessionID,
            title: "Test",
            agent: "build",
            model: { providerID: "test", id: "model" },
            time: { created: 1 },
            location: { directory: "/work/a" },
          }
        },
        async context() {
          return [{ id: "u1", type: "user", time: { created: 1 }, text: "hello" }]
        },
      },
      rpc: {
        async register() {
          return { dispose: async () => {} }
        },
      },
      event: {
        subscribe({ signal }: { signal: AbortSignal }) {
          return (async function* () {
            while (!signal.aborted) {
              const event = events.shift()
              if (event) yield event
              else await sleep(10)
            }
          })()
        },
      },
    }

    const cleanup = (await plugin.setup(ctx as any)) as () => Promise<void>
    try {
      await sleep(150)
      expect(fetches).toHaveLength(0)

      events.push({ type: "session.text.delta", data: { sessionID: "ses_1" } })
      await sleep(1200)
      expect(fetches).toHaveLength(0)

      events.push({ type: "session.text.ended", data: { sessionID: "ses_1" } })
      await sleep(1200)
      expect(fetches).toHaveLength(1)
      expect(fetches[0]).toContain("/api/shares/share_1/sync")
    } finally {
      await cleanup()
      globalThis.fetch = originalFetch
    }
  })
})
