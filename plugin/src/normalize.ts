import type {
  ShareAssistantPart,
  ShareMessage,
  ShareSnapshot,
  ShareToolPart,
} from "./types"

const MAX_REASONING = 200_000
const MAX_OUTPUT = 200_000

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g

function cut(value: string, limit: number) {
  if (value.length <= limit) return { value, truncated: false }
  return { value: `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]`, truncated: true }
}

function clean(value: string, root: string) {
  let text = value.replace(ANSI, "").replace(CONTROL, "")
  if (root) text = text.replaceAll(root, "<project>")
  const home = root.match(
    /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/i,
  )?.[0]
  if (home) text = text.replaceAll(home, "~")
  return text
}

function redactJson(value: unknown, root: string, depth = 0): unknown {
  if (depth > 24) return "[depth limit]"
  if (typeof value === "string") return clean(value, root)
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactJson(item, root, depth + 1))
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue
      result[key] = redactJson(item, root, depth + 1)
    }
    return result
  }
  return value
}

function normalizeTool(part: any, root: string, truncated: { value: boolean }) {
  const state = part.state
  if (!state) return null
  if (state.status !== "completed" && state.status !== "error") return null

  const durationMs =
    typeof part.time?.ran === "number" && typeof part.time?.completed === "number"
      ? Math.max(0, part.time.completed - part.time.ran)
      : undefined

  if (state.status === "completed") {
    const content = Array.isArray(state.content) ? state.content : []
    const output = content
      .map((entry: any) => {
        if (entry.type === "text") return entry.text
        return `[file: ${entry.name ?? entry.uri}]`
      })
      .join("\n")
    const cleaned = output ? clean(output, root) : ""
    const limited = cut(cleaned, MAX_OUTPUT)
    if (limited.truncated) truncated.value = true
    return {
      type: "tool" as const,
      name: part.name,
      status: "completed" as const,
      input: redactJson(state.input, root),
      output: limited.value || undefined,
      durationMs,
    } satisfies ShareToolPart
  }

  const limited = cut(clean(state.error?.message ?? "", root), 40_000)
  if (limited.truncated) truncated.value = true
  return {
    type: "tool" as const,
    name: part.name,
    status: "error" as const,
    input: redactJson(state.input, root),
    error: limited.value,
    durationMs,
  } satisfies ShareToolPart
}

export function normalizeSession(
  app: { version: string },
  location: { directory: string },
  info: any,
  messages: readonly any[],
): ShareSnapshot {
  const root = location.directory
  const truncated = { value: false }
  const dropped = new Set<string>(["system", "skill", "synthetic", "native", "snapshots"])
  const output: ShareMessage[] = []

  for (const message of messages) {
    if (message.type === "user") {
      output.push({
        role: "user",
        time: message.time.created,
        text: clean(message.text, root),
        files: message.files?.map((file: any) => ({ name: file.name, mime: file.mime })),
      })
      continue
    }

    if (message.type === "assistant") {
      if (!message.time.completed) {
        dropped.add("incomplete assistant messages")
        continue
      }
      const content: ShareAssistantPart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          if (!part.text) continue
          content.push({ type: "text", text: clean(part.text, root) })
          continue
        }
        if (part.type === "reasoning") {
          if (!part.text) continue
          const text = cut(clean(part.text, root), MAX_REASONING)
          if (text.truncated) truncated.value = true
          const durationMs =
            typeof part.time?.created === "number" && typeof part.time?.completed === "number"
              ? Math.max(0, part.time.completed - part.time.created)
              : undefined
          content.push({
            type: "reasoning",
            text: text.value,
            ...(durationMs !== undefined ? { durationMs } : {}),
          })
          continue
        }
        if (part.type === "tool") {
          const tool = normalizeTool(part, root, truncated)
          if (tool) content.push(tool)
          continue
        }
      }
      if (!content.length) continue
      output.push({
        role: "assistant",
        time: message.time.created,
        completed: message.time.completed,
        agent: message.agent,
        model: message.model,
        content,
        cost: message.cost,
        tokens: message.tokens,
      })
      continue
    }

    if (message.type === "shell") {
      if (message.status === "running") {
        dropped.add("running shell messages")
        continue
      }
      const command = cut(clean(message.command, root), 40_000)
      const shellOutput = message.output ? cut(clean(message.output.output, root), MAX_OUTPUT) : undefined
      if (command.truncated || shellOutput?.truncated) truncated.value = true
      output.push({
        role: "shell",
        time: message.time.created,
        command: command.value,
        output: shellOutput?.value,
        exit: message.exit,
        status: message.status,
      })
      continue
    }

    if (message.type === "compaction") {
      if (message.status !== "completed") continue
      output.push({
        role: "notice",
        kind: "compaction",
        time: message.time?.created ?? Date.now(),
        text: clean(message.summary, root),
      })
      continue
    }

    dropped.add(message.type)
  }

  const firstUser = output.find((message) => message.role === "user")
  const title = clean(
    info.title?.trim() || (firstUser?.role === "user" ? firstUser.text.slice(0, 80) : "") || "OpenCode Session",
    root,
  ).slice(0, 300)

  return {
    v: 1,
    title,
    createdAt: info.time?.created ?? Date.now(),
    source: { app: "opencode", version: app.version },
    session: {
      id: info.id,
      agent: info.agent,
      model: info.model,
    },
    privacy: {
      dropped: [...dropped],
      truncated: truncated.value || undefined,
    },
    messages: output,
  }
}
