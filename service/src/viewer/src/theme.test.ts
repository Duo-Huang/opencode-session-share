import { describe, expect, test } from "bun:test"
import { normalizeThemeMode, resolveTheme } from "./theme"

describe("theme mode", () => {
  test("normalizes stored values and defaults to system", () => {
    expect(normalizeThemeMode("light")).toBe("light")
    expect(normalizeThemeMode("dark")).toBe("dark")
    expect(normalizeThemeMode("system")).toBe("system")
    expect(normalizeThemeMode(null)).toBe("system")
    expect(normalizeThemeMode("unexpected")).toBe("system")
  })

  test("resolves the system mode against the current preference", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })
})
