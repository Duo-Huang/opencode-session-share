import { describe, expect, test } from "bun:test"
import type { ShareMessage } from "../../../../shared/types"
import { planLiveChange, trimToTotal, type LoadedRange } from "./view-state"

function message(text: string): ShareMessage {
  return { role: "user", time: 1, text }
}

describe("planLiveChange", () => {
  test("distinguishes append, revert trim, and reset", () => {
    expect(planLiveChange({ total: 10 }, { total: 10 })).toEqual({ kind: "noop" })
    expect(planLiveChange({ total: 10 }, { total: 12 })).toEqual({ kind: "append", total: 12 })
    expect(planLiveChange({ total: 10 }, { total: 8, reverted: true })).toEqual({
      kind: "trim",
      total: 8,
    })
    expect(planLiveChange({ total: 10 }, { total: 8 })).toEqual({ kind: "reset", total: 8 })
  })
})

describe("trimToTotal", () => {
  test("drops the suffix and clips loaded ranges", () => {
    const messages = new Map<number, ShareMessage>([
      [0, message("a")],
      [1, message("b")],
      [2, message("c")],
    ])
    const ranges: LoadedRange[] = [
      { start: 0, end: 2, bytes: 10, touchedAt: 1 },
      { start: 2, end: 3, bytes: 10, touchedAt: 2 },
    ]

    const trimmed = trimToTotal(messages, ranges, 2)

    expect([...trimmed.messages.keys()]).toEqual([0, 1])
    expect(trimmed.ranges).toEqual([{ start: 0, end: 2, bytes: 10, touchedAt: 1 }])
  })

  test("removes ranges entirely after the new total", () => {
    const messages = new Map<number, ShareMessage>([
      [0, message("a")],
      [5, message("b")],
    ])
    const ranges: LoadedRange[] = [{ start: 5, end: 6, bytes: 10, touchedAt: 1 }]

    const trimmed = trimToTotal(messages, ranges, 3)

    expect(trimmed.messages.size).toBe(1)
    expect(trimmed.messages.has(0)).toBe(true)
    expect(trimmed.ranges).toEqual([])
  })
})
