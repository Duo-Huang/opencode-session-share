import { describe, expect, test } from "bun:test"
import {
  ShareSnapshotSchema,
  buildIndex,
  buildMessagePage,
  buildShareView,
  compactSnapshotForView,
  searchSnapshot,
  type ValidShareSnapshot,
} from "./payload"

function makeSnapshot(outputSize = 10, text = "answer"): ValidShareSnapshot {
  return {
    v: 1,
    title: "Large",
    createdAt: 1,
    source: { app: "opencode", version: "2.1.4" },
    session: { agent: "build" },
    messages: [
      { role: "user", time: 1, text: "hello" },
      {
        role: "assistant",
        time: 2,
        completed: 3,
        content: [
          { type: "reasoning", text: "private thinking", durationMs: 5 },
          { type: "text", text },
          {
            type: "tool",
            name: "bash",
            status: "completed",
            input: { command: "cat big.log", secret: "tool-only-secret" },
            output: `tool-output ${"x".repeat(outputSize)}`,
          },
        ],
      },
    ],
  }
}

describe("compactSnapshotForView", () => {
  test("keeps visible body text and strips detail bodies", () => {
    const compact = compactSnapshotForView(makeSnapshot(10))

    expect(compact.bodyTruncated).toBe(false)
    expect(compact.detailsOmitted).toBe(true)
    expect(compact.privacy?.detailsOmitted).toBe(true)
    expect(compact.messages[0]).toMatchObject({ role: "user", text: "hello" })
    const assistant = compact.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const text = assistant.content.find((part) => part.type === "text")
    const reasoning = assistant.content.find((part) => part.type === "reasoning")
    const tool = assistant.content.find((part) => part.type === "tool")
    expect(text && text.type === "text" ? text.text : "").toBe("answer")
    expect(reasoning && reasoning.type === "reasoning" ? reasoning.text : "x").toBe("")
    if (!tool || tool.type !== "tool") throw new Error("expected tool")
    expect(tool.output).toBeUndefined()
    expect(tool.input).toMatchObject({ command: "cat big.log" })
  })

  test("never truncates a long message", () => {
    const longText = "x".repeat(200_000)
    const snapshot = makeSnapshot(0, longText)
    const compact = compactSnapshotForView(snapshot)
    const assistant = compact.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const text = assistant.content.find((part) => part.type === "text")
    expect(text && text.type === "text" ? text.text.length : 0).toBe(200_000)
    expect(compact.bodyTruncated).toBe(false)
  })
})

describe("buildMessagePage", () => {
  test("pages by complete messages and can isolate one oversized message", () => {
    const longText = "x".repeat(200_000)
    const snapshot = makeSnapshot(0, longText)
    const compact = compactSnapshotForView(snapshot)
    const page = buildMessagePage(compact.messages, 64 * 1024)

    expect(page.start).toBe(0)
    expect(page.end).toBe(1)
    expect(page.hasAfter).toBe(true)
    expect(page.messages).toHaveLength(1)
    const first = page.messages[0]
    expect(first.role).toBe("user")
  })

  test("returns a whole oversized message as its own page", () => {
    const snapshot = makeSnapshot(0, "x".repeat(200_000))
    const compact = compactSnapshotForView(snapshot)
    const page = buildMessagePage(compact.messages, 64 * 1024, { start: 1 })
    const assistant = page.messages[0]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const text = assistant.content.find((part) => part.type === "text")
    expect(text && text.type === "text" ? text.text.length : 0).toBe(200_000)
  })

  test("centers an around page and reports its byte size", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      time: index,
      text: "x".repeat(200),
    }))
    const page = buildMessagePage(messages, 1024, { around: 5 })

    expect(page.start).toBeLessThan(5)
    expect(page.end).toBeGreaterThan(5)
    expect(page.start).toBeLessThanOrEqual(5)
    expect(page.bytes).toBeGreaterThan(0)
  })

  test("fills backward when the around target is the last message", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      time: index,
      text: "x".repeat(200),
    }))
    const page = buildMessagePage(messages, 1024, { around: 9 })

    expect(page.end).toBe(10)
    expect(page.start).toBeLessThan(9)
    expect(page.hasAfter).toBe(false)
  })
})

describe("buildIndex", () => {
  test("covers user and assistant turns without tool-only entries", () => {
    const snapshot = makeSnapshot()
    const index = buildIndex(snapshot)
    expect(index).toHaveLength(2)
    expect(index[0]).toMatchObject({ id: "m-0", role: "user", messageIndex: 0 })
    expect(index[1].role).toBe("assistant")
    expect(index[1].id).toBe("p-1-1")
    expect(index[1].messageIndex).toBe(1)
  })
})

describe("buildShareView", () => {
  test("includes the complete index and total stats", () => {
    const snapshot = ShareSnapshotSchema.parse(makeSnapshot())
    const view = buildShareView(snapshot, 64 * 1024)
    expect(view.index).toHaveLength(2)
    expect(view.stats.messages).toBe(2)
    expect(view.stats.turns).toBe(2)
    expect(view.messages.length).toBeGreaterThan(0)
    expect(ShareSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })

  test("counts grouped assistant steps as one visible turn", () => {
    const base = makeSnapshot()
    const assistant = base.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const snapshot: ValidShareSnapshot = {
      ...base,
      messages: [
        base.messages[0],
        assistant,
        { ...assistant, time: assistant.time + 1 },
        { role: "user", time: 4, text: "again" },
        { ...assistant, time: 5 },
      ],
    }

    const view = buildShareView(snapshot, 64 * 1024)
    expect(view.stats.messages).toBe(5)
    expect(view.stats.turns).toBe(4)
    // Pagination still uses the raw message total.
    expect(view.total).toBe(5)
  })
})

describe("searchSnapshot", () => {
  test("searches user and assistant text only", () => {
    const snapshot = makeSnapshot()
    expect(searchSnapshot(snapshot, "hello").map((result) => result.role)).toEqual(["user"])
    expect(searchSnapshot(snapshot, "answer").map((result) => result.role)).toEqual(["assistant"])
    expect(searchSnapshot(snapshot, "private thinking")).toEqual([])
    expect(searchSnapshot(snapshot, "tool-only-secret")).toEqual([])
    expect(searchSnapshot(snapshot, "tool-output")).toEqual([])
  })
})
