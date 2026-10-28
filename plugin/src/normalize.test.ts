import { describe, expect, test } from "bun:test"
import { normalizeSession } from "./normalize"

describe("normalizeSession", () => {
  test("keeps v1-style parts and drops private/system traffic", () => {
    const snapshot = normalizeSession(
      { version: "2.1.4" },
      { directory: "/Users/me/project" },
      {
        id: "ses_1",
        title: "Build login",
        agent: "build",
        model: { providerID: "openai", id: "gpt" },
        time: { created: 1000 },
      },
      [
        {
          id: "u1",
          type: "user",
          time: { created: 1001 },
          text: "fix /Users/me/project/a.ts",
          files: [{ name: "a.ts", mime: "text/plain" }],
        },
        {
          id: "a1",
          type: "assistant",
          time: { created: 1002, completed: 1010 },
          agent: "build",
          model: { providerID: "openai", id: "gpt" },
          cost: 0.01,
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 0, write: 0 } },
          content: [
            { type: "text", text: "done" },
            { type: "reasoning", text: "thinking", time: { created: 1003, completed: 1006 } },
            {
              type: "tool",
              id: "t1",
              name: "bash",
              time: { created: 1003, ran: 1004, completed: 1006 },
              state: {
                status: "completed",
                input: { command: "cat /Users/me/project/a.ts" },
                content: [{ type: "text", text: "hello" }],
              },
            },
          ],
        },
        {
          id: "s1",
          type: "system",
          time: { created: 1011 },
          text: "secret system prompt",
        },
        {
          id: "c1",
          type: "compaction",
          status: "completed",
          reason: "auto",
          summary: "earlier work",
          time: { created: 1012 },
        },
      ] as any,
    )

    expect(snapshot.session.id).toBe("ses_1")
    expect(snapshot.title).toBe("Build login")
    expect(snapshot.messages).toHaveLength(3)
    expect(snapshot.messages[0]).toMatchObject({
      role: "user",
      text: "fix <project>/a.ts",
    })
    const assistant = snapshot.messages[1]
    expect(assistant.role).toBe("assistant")
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    expect(assistant.content[1]).toMatchObject({
      type: "reasoning",
      text: "thinking",
      durationMs: 3,
    })
    expect(assistant.content[2]).toMatchObject({
      type: "tool",
      name: "bash",
      output: "hello",
      durationMs: 2,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret system prompt")
  })

  test("keeps a compacted context as summary plus post-compaction messages", () => {
    const snapshot = normalizeSession(
      { version: "2.1.4" },
      { directory: "/Users/me/project" },
      { id: "ses_3", time: { created: 1 } },
      [
        {
          id: "c1",
          type: "compaction",
          status: "completed",
          summary: "earlier work",
          time: { created: 10_000 },
          metadata: {
            keepID: "u1",
            recent:
              "[User]: first prompt\n\n[Assistant tool call]: bash({})\n\n[Tool result]: ok\n\n[User]: second prompt\nline two\n\n[Assistant tool call]: read({})",
          },
        },
        {
          id: "a1",
          type: "assistant",
          time: { created: 10_001, completed: 10_002 },
          content: [{ type: "text", text: "answer" }],
        },
      ] as any,
    )

    expect(snapshot.messages.map((message) => message.role)).toEqual(["notice", "assistant"])
    expect(snapshot.messages[0]).toMatchObject({
      role: "notice",
      kind: "compaction",
      text: "earlier work",
    })
  })

  test("redacts Windows home paths", () => {
    const snapshot = normalizeSession(
      { version: "2.1.4" },
      { directory: "C:\\Users\\me\\project" },
      { id: "ses_win", time: { created: 1 } },
      [
        {
          id: "u1",
          type: "user",
          time: { created: 2 },
          text: "open C:\\Users\\me\\project\\a.ts and C:\\Users\\me\\Downloads\\b.txt",
        },
      ] as any,
    )

    const text = snapshot.messages[0]
    expect(text.role).toBe("user")
    if (text.role !== "user") throw new Error("expected user")
    expect(text.text).toContain("<project>")
    expect(text.text).toContain("~\\Downloads")
    expect(text.text).not.toContain("C:\\Users\\me")
  })

  test("keeps long visible text intact", () => {
    const longText = "x".repeat(100_000)
    const snapshot = normalizeSession(
      { version: "2.1.4" },
      { directory: "/tmp" },
      { id: "ses_long", time: { created: 1 } },
      [
        { id: "u1", type: "user", time: { created: 2 }, text: longText },
        {
          id: "a1",
          type: "assistant",
          time: { created: 3, completed: 4 },
          content: [{ type: "text", text: longText }],
        },
      ] as any,
    )

    expect(snapshot.messages[0]).toMatchObject({ role: "user", text: longText })
    const assistant = snapshot.messages[1]
    if (assistant.role !== "assistant") throw new Error("expected assistant")
    const text = assistant.content[0]
    expect(text && text.type === "text" ? text.text : "").toBe(longText)
  })

  test("drops incomplete assistant messages", () => {
    const snapshot = normalizeSession(
      { version: "2.1.4" },
      { directory: "/tmp" },
      { id: "ses_2", time: { created: 1 } },
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: 2 },
          content: [{ type: "text", text: "partial" }],
        },
      ] as any,
    )
    expect(snapshot.messages).toHaveLength(0)
  })
})
