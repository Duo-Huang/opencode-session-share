import { z } from "zod"
import type { ShareIndexItem, SharePageInfo, SharePrivacy } from "../../../shared/types"

const ModelRef = z
  .object({
    providerID: z.string().min(1).max(120),
    id: z.string().min(1).max(200),
    variant: z.string().max(80).optional(),
  })
  .strict()

const TokenUsage = z
  .object({
    input: z.number().nonnegative().default(0),
    output: z.number().nonnegative().default(0),
    reasoning: z.number().nonnegative().default(0),
    cache: z
      .object({
        read: z.number().nonnegative().default(0),
        write: z.number().nonnegative().default(0),
      })
      .strict()
      .optional(),
  })
  .strict()

const File = z
  .object({
    name: z.string().max(500).optional(),
    mime: z.string().max(200),
  })
  .strict()

const TextPart = z
  .object({
    type: z.literal("text"),
    text: z.string().max(2_000_000),
  })
  .strict()

const ReasoningPart = z
  .object({
    type: z.literal("reasoning"),
    text: z.string().max(2_000_000),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .strict()

const ToolPart = z
  .object({
    type: z.literal("tool"),
    name: z.string().min(1).max(200),
    status: z.enum(["completed", "error"]),
    input: z.unknown(),
    output: z.string().max(2_000_000).optional(),
    error: z.string().max(40_000).optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .strict()

const AssistantPart = z.discriminatedUnion("type", [TextPart, ReasoningPart, ToolPart])

const Message = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      time: z.number().int(),
      text: z.string().max(2_000_000),
      files: z.array(File).max(100).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      time: z.number().int(),
      completed: z.number().int().optional(),
      agent: z.string().max(200).optional(),
      model: ModelRef.optional(),
      content: z.array(AssistantPart).max(1000),
      cost: z.number().nonnegative().optional(),
      tokens: TokenUsage.optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("shell"),
      time: z.number().int(),
      command: z.string().max(40_000),
      output: z.string().max(2_000_000).optional(),
      exit: z.union([z.number(), z.string()]).optional(),
      status: z.enum(["exited", "timeout", "killed"]),
    })
    .strict(),
  z
    .object({
      role: z.literal("notice"),
      kind: z.enum(["synthetic", "system", "compaction"]),
      time: z.number().int(),
      text: z.string().max(2_000_000),
    })
    .strict(),
])

export const ShareSnapshotSchema = z
  .object({
    v: z.literal(1),
    title: z.string().min(1).max(300),
    createdAt: z.number().int(),
    source: z
      .object({
        app: z.literal("opencode"),
        version: z.string().max(80),
      })
      .strict(),
    session: z
      .object({
        id: z.string().min(1).max(300).optional(),
        agent: z.string().max(200).optional(),
        model: ModelRef.optional(),
      })
      .strict(),
    privacy: z
      .object({
        redacted: z.array(z.string().max(80)).max(50).optional(),
        dropped: z.array(z.string().max(80)).max(50).optional(),
        truncated: z.boolean().optional(),
        detailsOmitted: z.boolean().optional(),
        bodyTruncated: z.boolean().optional(),
      })
      .strict()
      .optional(),
    messages: z.array(Message).min(1).max(3000),
  })
  .strict()

export type ValidShareSnapshot = z.infer<typeof ShareSnapshotSchema>
type SnapshotMessage = ValidShareSnapshot["messages"][number]
export type ShareStats = {
  messages: number
  tools: number
  cost: number
  tokens: { input: number; output: number; reasoning: number }
}

export type ShareMessagePage = SharePageInfo & {
  messages: SnapshotMessage[]
}

export type CompactView = {
  messages: SnapshotMessage[]
  privacy?: SharePrivacy
  detailsOmitted: boolean
  bodyTruncated: boolean
}

export type LiveView = {
  index: ShareIndexItem[]
  privacy?: SharePrivacy
  stats: ShareStats
  total: number
}

export type SearchResult = ShareIndexItem

type PageCursor = { start?: number; before?: number }

const BODY_TRUNCATION = /\n… \[truncated(?: for share| \d+ chars)\]$/
const PREVIEW_LIMIT = 80
const DETAILS_DROPPED = "tool and thinking details omitted"
const BODY_DROPPED = "message text omitted"

function previewText(value: string, limit = PREVIEW_LIMIT) {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

function markedTruncated(value: string) {
  return BODY_TRUNCATION.test(value.trimEnd())
}

function summarizeToolInput(input: unknown): unknown {
  if (typeof input === "string") return input.slice(0, 200)
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  const output: Record<string, string> = {}
  for (const key of ["command", "cmd", "filePath", "path", "pattern", "query", "url", "description"]) {
    const value = source[key]
    if (typeof value === "string" && value) output[key] = value.slice(0, 200)
  }
  return output
}

function buildPrivacy(
  snapshot: ValidShareSnapshot,
  flags: { details: boolean; body: boolean },
): SharePrivacy | undefined {
  const dropped = new Set(snapshot.privacy?.dropped ?? [])
  if (flags.details) dropped.add(DETAILS_DROPPED)
  if (flags.body) dropped.add(BODY_DROPPED)
  if (!flags.details && !flags.body && dropped.size === 0 && !snapshot.privacy?.redacted?.length) {
    return snapshot.privacy
  }
  const privacy: SharePrivacy = {
    ...snapshot.privacy,
    ...(flags.details ? { detailsOmitted: true, truncated: true } : {}),
    ...(flags.body ? { bodyTruncated: true, truncated: true } : {}),
    ...(dropped.size ? { dropped: [...dropped].slice(0, 50) } : {}),
  }
  return privacy
}

function compactMessage(message: SnapshotMessage, flags: { details: boolean; body: boolean }) {
  if (message.role === "user") {
    if (markedTruncated(message.text)) flags.body = true
    return message
  }
  if (message.role === "assistant") {
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "text") {
          if (markedTruncated(part.text)) flags.body = true
          return part
        }
        flags.details = true
        if (part.type === "reasoning") return { ...part, text: "" }
        return {
          type: part.type,
          name: part.name,
          status: part.status,
          input: summarizeToolInput(part.input),
          ...(part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
        }
      }),
    }
  }
  if (message.role === "notice") {
    if (markedTruncated(message.text)) flags.body = true
    return message
  }
  return message
}

/**
 * Keep every visible body string intact. Tool and thinking bodies are removed
 * from page payloads; the detail endpoint serves them on demand.
 */
export function compactSnapshotForView(snapshot: ValidShareSnapshot): CompactView {
  const flags = { details: false, body: snapshot.privacy?.bodyTruncated === true }
  const messages = snapshot.messages.map((message) => compactMessage(message, flags))
  return {
    messages,
    privacy: buildPrivacy(snapshot, flags),
    detailsOmitted: flags.details,
    bodyTruncated: flags.body,
  }
}

/**
 * A page is always a contiguous range of complete messages. If one message is
 * larger than the budget it gets a page of its own; it is never split.
 */
export function buildMessagePage(
  messages: SnapshotMessage[],
  maxBytes: number,
  cursor: PageCursor = {},
): ShareMessagePage {
  const total = messages.length
  if (!total) {
    return { messages: [], start: 0, end: 0, total: 0, hasBefore: false, hasAfter: false }
  }
  const budget = Math.max(1024, maxBytes - 4096)
  const size = (message: SnapshotMessage) => Buffer.byteLength(JSON.stringify(message)) + 1

  let start: number
  let end: number
  let bytes = 0

  if (cursor.before !== undefined) {
    end = Math.max(0, Math.min(cursor.before, total))
    if (end === 0) end = 1
    start = end
    while (start > 0) {
      const next = size(messages[start - 1])
      if (start < end && bytes + next > budget) break
      bytes += next
      start--
    }
    if (start === end) start = end - 1
  } else {
    start = Math.max(0, Math.min(cursor.start ?? 0, total - 1))
    end = start
    while (end < total) {
      const next = size(messages[end])
      if (end > start && bytes + next > budget) break
      bytes += next
      end++
    }
    if (end === start) end = start + 1
  }

  return {
    messages: messages.slice(start, end),
    start,
    end,
    total,
    hasBefore: start > 0,
    hasAfter: end < total,
  }
}

function hasDeferredDetails(snapshot: ValidShareSnapshot) {
  return snapshot.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.content.some((part) => part.type === "reasoning" || part.type === "tool"),
  )
}

function hasBodyTruncation(snapshot: ValidShareSnapshot) {
  if (snapshot.privacy?.bodyTruncated) return true
  return snapshot.messages.some((message) => {
    if (message.role === "user" || message.role === "notice") return markedTruncated(message.text)
    if (message.role !== "assistant") return false
    return message.content.some((part) => part.type === "text" && markedTruncated(part.text))
  })
}

export function viewStats(snapshot: ValidShareSnapshot): ShareStats {
  return {
    messages: snapshot.messages.length,
    tools: countTools(snapshot),
    cost: totalCost(snapshot),
    tokens: totalTokens(snapshot),
  }
}

export function buildIndex(snapshot: ValidShareSnapshot): ShareIndexItem[] {
  const items: ShareIndexItem[] = []
  const messages = snapshot.messages

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === "user") {
      items.push({
        id: `m-${index}`,
        role: "user",
        time: message.time,
        preview: previewText(message.text) || "Attachment",
        messageIndex: index,
      })
      continue
    }
    if (message.role !== "assistant") continue

    const turnStart = index
    const turnTime = message.time
    let target = ""
    let text = ""
    while (index < messages.length) {
      const entry = messages[index]
      if (entry.role !== "assistant") break
      for (let partIndex = 0; partIndex < entry.content.length; partIndex++) {
        const part = entry.content[partIndex]
        if (part.type !== "text" || !part.text.trim()) continue
        if (!target) target = `p-${index}-${partIndex}`
        text += `${text ? "\n\n" : ""}${part.text}`
      }
      index++
    }
    index--
    if (!target || !text.trim()) continue
    items.push({
      id: target,
      role: "assistant",
      time: turnTime,
      preview: previewText(text),
      messageIndex: turnStart,
    })
  }

  return items
}

export function buildShareView(snapshot: ValidShareSnapshot, maxBytes: number) {
  const compact = compactSnapshotForView(snapshot)
  return {
    ...buildMessagePage(compact.messages, maxBytes),
    index: buildIndex(snapshot),
    privacy: compact.privacy,
    stats: viewStats(snapshot),
    detailsOmitted: compact.detailsOmitted,
    bodyTruncated: compact.bodyTruncated,
  }
}

export function buildPageView(
  snapshot: ValidShareSnapshot,
  maxBytes: number,
  cursor: PageCursor,
) {
  const compact = compactSnapshotForView(snapshot)
  return {
    ...buildMessagePage(compact.messages, maxBytes, cursor),
    privacy: compact.privacy,
  }
}

export function buildLiveView(snapshot: ValidShareSnapshot): LiveView {
  return {
    index: buildIndex(snapshot),
    privacy: buildPrivacy(snapshot, {
      details: hasDeferredDetails(snapshot),
      body: hasBodyTruncation(snapshot),
    }),
    stats: viewStats(snapshot),
    total: snapshot.messages.length,
  }
}

function snippet(value: string, query: string) {
  const text = value.replace(/\s+/g, " ").trim()
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (at < 0) return previewText(text, 140)
  const start = Math.max(0, at - 48)
  const end = Math.min(text.length, at + query.length + 80)
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

/** Search only visible user/assistant text, never thinking or tool bodies. */
export function searchSnapshot(
  snapshot: ValidShareSnapshot,
  rawQuery: string,
  limit = 50,
): SearchResult[] {
  const query = rawQuery.trim()
  if (!query) return []
  const needle = query.toLocaleLowerCase()
  const results: SearchResult[] = []

  for (let index = 0; index < snapshot.messages.length && results.length < limit; index++) {
    const message = snapshot.messages[index]
    if (message.role === "user") {
      if (!message.text.toLocaleLowerCase().includes(needle)) continue
      results.push({
        id: `m-${index}`,
        role: "user",
        time: message.time,
        preview: snippet(message.text, query),
        messageIndex: index,
      })
      continue
    }
    if (message.role !== "assistant") continue
    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex]
      if (part.type !== "text" || !part.text.toLocaleLowerCase().includes(needle)) continue
      results.push({
        id: `p-${index}-${partIndex}`,
        role: "assistant",
        time: message.time,
        preview: snippet(part.text, query),
        messageIndex: index,
      })
      if (results.length >= limit) break
    }
  }

  return results
}

export function stripSessionId(snapshot: ValidShareSnapshot) {
  const { id: _id, ...session } = snapshot.session
  return {
    ...snapshot,
    session,
  }
}

export function countTools(snapshot: ValidShareSnapshot) {
  let count = 0
  for (const message of snapshot.messages) {
    if (message.role !== "assistant") continue
    count += message.content.filter((part) => part.type === "tool").length
  }
  return count
}

export function totalCost(snapshot: ValidShareSnapshot) {
  return snapshot.messages.reduce((total, message) => {
    if (message.role !== "assistant") return total
    return total + (message.cost ?? 0)
  }, 0)
}

export function totalTokens(snapshot: ValidShareSnapshot) {
  return snapshot.messages.reduce(
    (total, message) => {
      if (message.role !== "assistant" || !message.tokens) return total
      total.input += message.tokens.input
      total.output += message.tokens.output
      total.reasoning += message.tokens.reasoning
      return total
    },
    { input: 0, output: 0, reasoning: 0 },
  )
}
