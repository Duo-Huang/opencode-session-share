import { describe, expect, test } from "bun:test"
import { ShareSnapshotSchema, stripSessionId, totalCost, totalTokens } from "./payload"

const base = {
  v: 1,
  title: "Test",
  createdAt: 1,
  source: { app: "opencode", version: "2.1.4" },
  session: { id: "ses_1", agent: "build" },
  messages: [
    { role: "user", time: 1, text: "hello" },
    {
      role: "assistant",
      time: 2,
      completed: 3,
      content: [{ type: "text", text: "hi" }],
      cost: 0.25,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } },
    },
  ],
}

describe("ShareSnapshotSchema", () => {
  test("accepts a plugin snapshot and strips the session id", () => {
    const parsed = ShareSnapshotSchema.parse(base)
    expect(parsed.session.id).toBe("ses_1")
    const stored = stripSessionId(parsed)
    expect((stored.session as { id?: string }).id).toBeUndefined()
    expect(ShareSnapshotSchema.safeParse(stored).success).toBe(true)
  })

  test("accepts a stored snapshot without session id", () => {
    const stored = stripSessionId(ShareSnapshotSchema.parse(base))
    expect(ShareSnapshotSchema.safeParse(stored).success).toBe(true)
  })

  test("rejects empty messages", () => {
    expect(ShareSnapshotSchema.safeParse({ ...base, messages: [] }).success).toBe(false)
  })

  test("totals cost and tokens", () => {
    const parsed = ShareSnapshotSchema.parse(base)
    expect(totalCost(parsed)).toBe(0.25)
    expect(totalTokens(parsed)).toEqual({ input: 10, output: 5, reasoning: 2 })
  })
})
