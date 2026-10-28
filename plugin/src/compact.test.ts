import { describe, expect, test } from "bun:test"
import type { ShareSnapshot } from "./types"
import { compactForUpload } from "./compact"

function snapshot(output: string): ShareSnapshot {
  return {
    v: 1,
    title: "Test",
    createdAt: 1,
    source: { app: "opencode", version: "2.1.4" },
    session: { id: "ses_1" },
    messages: [
      { role: "user", time: 1, text: "hello" },
      {
        role: "assistant",
        time: 2,
        completed: 3,
        content: [
          { type: "text", text: "answer" },
          {
            type: "tool",
            name: "bash",
            status: "completed",
            input: { command: "cat big.log" },
            output,
          },
        ],
      },
    ],
  }
}

describe("compactForUpload", () => {
  test("caps tool output and marks the snapshot truncated", () => {
    const compact = compactForUpload(snapshot("x".repeat(100_000)), 64 * 1024)
    expect(compact.privacy?.truncated).toBe(true)
    expect(compact.privacy?.dropped).toContain("content truncated for upload")
    const assistant = compact.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const tool = assistant.content.find((part) => part.type === "tool")
    if (!tool || tool.type !== "tool") throw new Error("expected tool")
    expect(tool.output!.length).toBeLessThan(100_000)
  })

  test("returns the original snapshot when nothing needs truncation", () => {
    const original = snapshot("small")
    expect(compactForUpload(original)).toBe(original)
  })

  test("never cuts visible user or assistant text", () => {
    const longText = "x".repeat(100_000)
    const original = snapshot("x".repeat(100_000))
    original.messages[0] = { role: "user", time: 1, text: longText }
    const assistant = original.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    assistant.content[0] = { type: "text", text: longText }

    const compact = compactForUpload(original, 64 * 1024)
    expect(compact.messages[0]).toMatchObject({ role: "user", text: longText })
    const compactAssistant = compact.messages[1]
    if (compactAssistant.role !== "assistant") throw new Error("expected assistant")
    const text = compactAssistant.content[0]
    expect(text && text.type === "text" ? text.text : "").toBe(longText)
  })
})
