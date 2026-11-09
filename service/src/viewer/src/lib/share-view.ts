import type { ShareMessage } from "../../../../../shared/types"
import type { LoadedRange, PublicShare, ShareView } from "./types"

export function toShareView(data: PublicShare): ShareView {
  const { messages, page, ...meta } = data
  const loaded = new Map<number, ShareMessage>()
  messages.forEach((message, offset) => loaded.set(page.start + offset, message))
  const ranges: LoadedRange[] =
    page.end > page.start
      ? [{ start: page.start, end: page.end, bytes: page.bytes ?? 0, touchedAt: Date.now() }]
      : []
  return {
    ...meta,
    messages: loaded,
    ranges,
    total: page.total,
  }
}

export function hasBefore(view: ShareView) {
  return (view.ranges[0]?.start ?? 0) > 0
}

export function hasAfter(view: ShareView) {
  return (view.ranges.at(-1)?.end ?? 0) < view.total
}

export function modelLabels(view: ShareView) {
  const models = new Set<string>()
  if (view.session.model) models.add(`${view.session.model.providerID}/${view.session.model.id}`)
  for (const message of view.messages.values()) {
    if (message.role === "assistant" && message.model) {
      models.add(`${message.model.providerID}/${message.model.id}`)
    }
  }
  return [...models]
}
