import { afterEach, describe, expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { generateShareKeyPair } from "./client"
import plugin from "./index"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type TestEvent = { type: string; data: unknown }
type TestSnapshot = { snapshot: { session?: { running?: boolean } } }

function mockFetch(onBody?: (body: Uint8Array) => void) {
  const fetches: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetches.push(String(input))
    const body = init?.body
    if (body instanceof Uint8Array) onBody?.(body)
    return new Response(JSON.stringify({ ok: true, changed: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-share-api-version": "3",
      },
    })
  }) as typeof fetch
  return fetches
}

function makeContext(options: {
  shareID: string
  sessionID: string
  events: TestEvent[]
  sessionTime?: Record<string, number>
}) {
  const pair = generateShareKeyPair()
  const entries = new Map<string, unknown>([
    [
      `share:/work/a:${options.sessionID}`,
      {
        id: options.shareID,
        url: `https://example.test/s/${options.shareID}`,
        expiresAt: Date.now() + 86_400_000,
        privateKey: pair.privateKey,
        directory: "/work/a",
        endpoint: "https://example.test",
      },
    ],
  ])
  const sessionTime = options.sessionTime ?? { created: 1 }

  return {
    options: {
      endpoint: "https://example.test",
      keyId: "test",
      key: "0123456789abcdef0123456789abcdef",
    },
    location: { directory: "/work/a" },
    app: { version: "2.2.6" },
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
          time: sessionTime,
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
            const event = options.events.shift()
            if (event) yield event
            else await sleep(10)
          }
        })()
      },
    },
  }
}

describe("session-share plugin", () => {
  test("does not sync without a relevant event", async () => {
    originalFetch = globalThis.fetch
    const events: TestEvent[] = []
    const ctx = makeContext({ shareID: "share_1", sessionID: "ses_1", events })
    const fetches = mockFetch()

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

  test("tracks execution lifecycle as the running state", async () => {
    originalFetch = globalThis.fetch
    const events: TestEvent[] = []
    const snapshots: TestSnapshot[] = []
    const ctx = makeContext({
      shareID: "share_2",
      sessionID: "ses_2",
      events,
      sessionTime: { created: 1, busy: 200, idle: 100 },
    })
    mockFetch((body) => {
      snapshots.push(JSON.parse(gunzipSync(body).toString()))
    })

    const cleanup = (await plugin.setup(ctx as any)) as () => Promise<void>
    try {
      await sleep(300)

      // Startup hydration restores a turn that began before the plugin loaded.
      expect(snapshots.at(-1)?.snapshot.session?.running).toBe(true)

      events.push({ type: "session.execution.succeeded", data: { sessionID: "ses_2" } })
      await sleep(300)
      expect(snapshots.at(-1)?.snapshot.session?.running).toBe(false)

      events.push({ type: "session.execution.started", data: { sessionID: "ses_2" } })
      await sleep(300)
      expect(snapshots.at(-1)?.snapshot.session?.running).toBe(true)
    } finally {
      await cleanup()
      globalThis.fetch = originalFetch
    }
  })
})
