import type { ShareMessage } from "../../../../shared/types"

export type LoadedRange = {
  /** First message index in this loaded chunk, inclusive. */
  start: number
  /** Last message index in this loaded chunk, exclusive. */
  end: number
  /** Uncompressed JSON bytes of the messages in this chunk. */
  bytes: number
  /** Last time this chunk was used, for the bounded range cache. */
  touchedAt: number
}

// Keep the sparse document bounded without giving up the initial window.
export const MAX_LOADED_RANGES = 4

// The viewer cache is derived from the server's page budget. Four pages is
// enough to keep the initial window, the live tail, and the jump target.
export const DEFAULT_VIEW_MAX_BYTES = 128 * 1024
export const LOADED_BYTES_MULTIPLIER = 4
export const MIN_LOADED_BYTES = 512 * 1024

export type ReconcilePlan =
  | { kind: "noop" }
  | { kind: "append"; total: number }
  | { kind: "trim"; total: number }
  | { kind: "reset"; total: number }

/**
 * Decides how the viewer should react to a live snapshot change. A shrink is
 * a suffix trim only when the snapshot explicitly says it is a staged revert;
 * otherwise it may be a compaction/rewrite and needs a reset.
 */
export function planLiveChange(
  current: { total: number },
  next: { total: number; reverted?: boolean },
): ReconcilePlan {
  if (next.total === current.total) return { kind: "noop" }
  if (next.total > current.total) return { kind: "append", total: next.total }
  if (next.reverted) return { kind: "trim", total: next.total }
  return { kind: "reset", total: next.total }
}

/** Drops messages at and after `total` and clips loaded ranges to it. */
export function trimToTotal(
  messages: Map<number, ShareMessage>,
  ranges: LoadedRange[],
  total: number,
): { messages: Map<number, ShareMessage>; ranges: LoadedRange[] } {
  const nextMessages = new Map<number, ShareMessage>()
  for (const [index, message] of messages) {
    if (index < total) nextMessages.set(index, message)
  }
  const nextRanges = ranges
    .map((range) => ({ ...range, end: Math.min(range.end, total) }))
    .filter((range) => range.start < range.end)
  return { messages: nextMessages, ranges: nextRanges }
}

export function mergeLoadedRanges(ranges: LoadedRange[]): LoadedRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start)
  const merged: LoadedRange[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
      last.bytes += range.bytes
      last.touchedAt = Math.max(last.touchedAt, range.touchedAt)
      continue
    }
    merged.push({ ...range })
  }
  return merged
}

export function trimLoadedRanges(
  ranges: LoadedRange[],
  messages: Map<number, ShareMessage>,
  focusIndex: number,
  total: number,
  maxBytes: number,
): LoadedRange[] {
  const pinned = new Set<LoadedRange>()
  for (const range of ranges) {
    if (range.start === 0) pinned.add(range)
    if (range.end === total) pinned.add(range)
    if (focusIndex >= range.start && focusIndex < range.end) {
      range.touchedAt = Date.now()
      pinned.add(range)
    }
  }
  const candidates = ranges
    .filter((range) => !pinned.has(range))
    .sort((left, right) => left.touchedAt - right.touchedAt)
  let bytes = ranges.reduce((sum, range) => sum + range.bytes, 0)
  while (ranges.length > MAX_LOADED_RANGES || bytes > maxBytes) {
    const victim = candidates.shift()
    if (!victim) break
    const index = ranges.indexOf(victim)
    if (index === -1) continue
    ranges.splice(index, 1)
    for (let messageIndex = victim.start; messageIndex < victim.end; messageIndex++) {
      messages.delete(messageIndex)
    }
    bytes -= victim.bytes
  }
  return ranges
}
