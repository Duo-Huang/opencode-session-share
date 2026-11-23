import { describe, expect, test } from "bun:test"
import {
  millis,
  needsCatchUp,
  persistedRunning,
  sessionMarker,
  sessionTime,
} from "./session-state"

describe("session clock helpers", () => {
  test("reads milliseconds from numbers, dates, and Effect date-times", () => {
    expect(millis(123)).toBe(123)
    expect(millis(new Date(456))).toBe(456)
    expect(millis({ epochMillis: 789 })).toBe(789)
    expect(millis({ epochMilliseconds: 101 })).toBe(101)
    expect(millis(undefined)).toBeUndefined()
    expect(millis("123")).toBeUndefined()
  })

  test("extracts the time field from session info", () => {
    expect(sessionTime({ time: { updated: 1 } })).toEqual({ updated: 1 })
    expect(sessionTime({})).toBeUndefined()
    expect(sessionTime(undefined)).toBeUndefined()
  })

  test("uses the latest updated or idle marker", () => {
    expect(sessionMarker({ updated: 100, idle: 200 })).toBe(200)
    expect(sessionMarker({ updated: 300, idle: 200 })).toBe(300)
    expect(sessionMarker({ idle: 200 })).toBe(200)
    expect(sessionMarker({})).toBeUndefined()
  })

  test("derives the running state from busy and idle", () => {
    expect(persistedRunning({ busy: 200, idle: 100 })).toBe(true)
    expect(persistedRunning({ busy: 100, idle: 200 })).toBe(false)
    expect(persistedRunning({ idle: 200 })).toBeUndefined()
  })

  test("catches up only when idle and newer than the last sync", () => {
    expect(needsCatchUp(undefined, 100, false)).toBe(true)
    expect(needsCatchUp(100, 100, false)).toBe(false)
    expect(needsCatchUp(100, 101, undefined)).toBe(true)
    expect(needsCatchUp(100, 101, true)).toBe(false)
    expect(needsCatchUp(100, undefined, false)).toBe(false)
  })
})
