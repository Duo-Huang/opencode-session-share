import { describe, expect, test } from "bun:test"
import type { LoadedRange } from "../view-state"
import { hasUnloadedGaps } from "./share-view"
import type { ShareView } from "./types"

function ranges(...items: Array<[number, number]>): LoadedRange[] {
  return items.map(([start, end], index) => ({
    start,
    end,
    bytes: 10,
    touchedAt: index,
  }))
}

function view(...items: Array<[number, number]>): ShareView {
  return { ranges: ranges(...items) } as ShareView
}

describe("hasUnloadedGaps", () => {
  test("detects a gap between adjacent ranges", () => {
    expect(hasUnloadedGaps(view([0, 10], [20, 30]))).toBe(true)
  })

  test("reports contiguous ranges as loaded", () => {
    expect(hasUnloadedGaps(view([0, 10], [10, 30]))).toBe(false)
  })

  test("ignores single and empty range lists", () => {
    expect(hasUnloadedGaps(view([5, 10]))).toBe(false)
    expect(hasUnloadedGaps(view())).toBe(false)
  })
})
