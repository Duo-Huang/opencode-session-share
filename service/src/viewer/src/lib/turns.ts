import type { ShareMessage } from "../../../../../shared/types"
import type {
  AssistantActivityPart,
  AssistantBlock,
  AssistantEntry,
  ShareView,
  TurnItem,
} from "./types"

export function buildTurnItems(messages: { message: ShareMessage; index: number }[]): TurnItem[] {
  const items: TurnItem[] = []
  let group: { start: number; messages: AssistantEntry[] } | undefined

  const flush = () => {
    if (!group) return
    items.push({
      kind: "assistant",
      key: `turn-${group.start}`,
      index: group.start,
      messages: group.messages,
    })
    group = undefined
  }

  for (const entry of messages) {
    if (entry.message.role === "assistant") {
      if (!group) group = { start: entry.index, messages: [] }
      group.messages.push({ message: entry.message, index: entry.index })
      continue
    }
    flush()
    items.push({
      kind: "message",
      key: `message-${entry.index}`,
      index: entry.index,
      message: entry.message,
    })
  }
  flush()
  return items
}

export function buildDisplayTurns(view: ShareView): TurnItem[] {
  const items: TurnItem[] = []
  let previousEnd: number | undefined
  for (const range of view.ranges) {
    if (previousEnd !== undefined && range.start > previousEnd) {
      items.push({
        kind: "gap",
        key: `gap-${previousEnd}-${range.start}`,
        start: previousEnd,
        end: range.start,
      })
    }
    const entries: { message: ShareMessage; index: number }[] = []
    for (let index = range.start; index < range.end; index++) {
      const message = view.messages.get(index)
      if (message) entries.push({ message, index })
    }
    items.push(...buildTurnItems(entries))
    previousEnd = range.end
  }
  return items
}

export function buildAssistantBlocks(entries: AssistantEntry[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = []
  let activity: AssistantActivityPart[] = []

  const flush = () => {
    if (!activity.length) return
    const reasoning = activity.filter((entry) => entry.part.type === "reasoning").length
    const tools = activity.filter((entry) => entry.part.type === "tool").length
    const durationMs = activity.reduce((total, entry) => total + (entry.part.durationMs ?? 0), 0)
    blocks.push({
      kind: "activity",
      key: `activity-${activity[0].messageIndex}-${activity[0].partIndex}`,
      parts: activity,
      reasoning,
      tools,
      durationMs,
    })
    activity = []
  }

  for (const entry of entries) {
    entry.message.content.forEach((part, partIndex) => {
      if (part.type === "tool" && part.name === "todoread") return
      if (part.type === "text") {
        if (!part.text.trim()) return
        flush()
        blocks.push({ kind: "text", id: `p-${entry.index}-${partIndex}`, text: part.text })
        return
      }
      activity.push({ messageIndex: entry.index, partIndex, part })
    })
  }
  flush()
  return blocks
}

export function turnMeta(entries: AssistantEntry[]) {
  const messages = entries.map((entry) => entry.message)
  const latest = [...messages].reverse()
  const tokens = messages.reduce(
    (total, message) => {
      if (!message.tokens) return total
      total.input += message.tokens.input
      total.output += message.tokens.output
      total.reasoning += message.tokens.reasoning
      return total
    },
    { input: 0, output: 0, reasoning: 0 },
  )
  return {
    agent: latest.find((message) => message.agent)?.agent,
    model: latest.find((message) => message.model)?.model,
    completed: latest.find((message) => message.completed !== undefined)?.completed,
    cost: messages.reduce((total, message) => total + (message.cost ?? 0), 0),
    tokens,
  }
}
