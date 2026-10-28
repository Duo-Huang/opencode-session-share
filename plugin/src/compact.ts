import type {
  ShareAssistantPart,
  ShareMessage,
  ShareSnapshot,
  ShareToolPart,
} from "./types"

const MARK = "\n… [truncated for share]"
const REASONING_CAP = 32_768
const OUTPUT_CAPS = [8_192, 4_096, 2_048, 1_024, 512, 0]
const DEFAULT_BUDGET = 512 * 1024

type Caps = { text: number; output: number; input: number }

function cut(value: string, limit: number, flag: { value: boolean }) {
  if (limit <= 0) {
    flag.value = true
    return ""
  }
  if (value.length <= limit) return value
  flag.value = true
  return `${value.slice(0, limit)}${MARK}`
}

function capJson(value: unknown, limit: number, flag: { value: boolean }, depth = 0): unknown {
  if (depth > 24) {
    flag.value = true
    return "[depth limit]"
  }
  if (typeof value === "string") return cut(value, limit, flag)
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => capJson(item, limit, flag, depth + 1))
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue
      output[key] = capJson(item, limit, flag, depth + 1)
    }
    return output
  }
  return value
}

function capPart(
  part: ShareAssistantPart,
  caps: Caps,
  flag: { value: boolean },
): ShareAssistantPart {
  // Visible assistant text is never cut. Only collapsible detail bodies are
  // bounded for the first upload.
  if (part.type === "text") return part
  if (part.type === "reasoning") {
    return { ...part, text: cut(part.text, REASONING_CAP, flag) }
  }
  return {
    ...part,
    input: capJson(part.input, caps.input, flag),
    ...(part.output !== undefined ? { output: cut(part.output, caps.output, flag) } : {}),
    ...(part.error !== undefined
      ? { error: cut(part.error, Math.min(caps.output || 1024, 2048), flag) }
      : {}),
  } satisfies ShareToolPart
}

function capMessage(
  message: ShareMessage,
  caps: Caps,
  flag: { value: boolean },
): ShareMessage {
  if (message.role === "user") return message
  if (message.role === "assistant") {
    return { ...message, content: message.content.map((part) => capPart(part, caps, flag)) }
  }
  if (message.role === "shell") {
    return {
      ...message,
      command: cut(message.command, Math.min(caps.text, 4096), flag),
      ...(message.output !== undefined ? { output: cut(message.output, caps.output, flag) } : {}),
    }
  }
  if (message.role === "notice") return message
  return message
}

function compactOnce(snapshot: ShareSnapshot, caps: Caps, flag: { value: boolean }): ShareSnapshot {
  const messages = snapshot.messages.map((message) => capMessage(message, caps, flag))
  if (!flag.value) return snapshot
  return {
    ...snapshot,
    privacy: {
      ...snapshot.privacy,
      truncated: true,
      dropped: [...(snapshot.privacy?.dropped ?? []), "content truncated for upload"].slice(0, 50),
    },
    messages,
  }
}

/**
 * The initial /share upload is the user-facing latency bottleneck. Upload a
 * bounded snapshot first; the watcher immediately syncs the full snapshot in
 * the background. This keeps the public endpoint and npm package unchanged
 * for every machine.
 */
export function compactForUpload(
  snapshot: ShareSnapshot,
  maxBytes = DEFAULT_BUDGET,
): ShareSnapshot {
  if (Buffer.byteLength(JSON.stringify(snapshot)) <= maxBytes) return snapshot

  for (const output of OUTPUT_CAPS) {
    const flag = { value: false }
    const compact = compactOnce(
      snapshot,
      { text: REASONING_CAP, output, input: Math.max(512, output) },
      flag,
    )
    if (flag.value && Buffer.byteLength(JSON.stringify(compact)) <= maxBytes) {
      return compact
    }
  }

  // Even if the snapshot is still large, return it with detail bodies removed.
  // Visible conversation text is never cut.
  return compactOnce(
    snapshot,
    { text: REASONING_CAP, output: 0, input: 512 },
    { value: false },
  )
}
