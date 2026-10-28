import { describe, expect, test } from "bun:test"
import { parseShareKey, shareKey } from "./storage"

describe("share storage keys", () => {
  test("round-trips the share directory and session", () => {
    const key = shareKey("/Users/me/project", "ses_123")
    expect(key).toBe("share:/Users/me/project:ses_123")
    expect(parseShareKey(key)).toEqual({
      directory: "/Users/me/project",
      sessionID: "ses_123",
    })
  })

  test("recovers a share created from another directory", () => {
    expect(parseShareKey("share:/Users/me:ses_456")).toEqual({
      directory: "/Users/me",
      sessionID: "ses_456",
    })
  })

  test("ignores unrelated storage keys", () => {
    expect(parseShareKey("share_consent")).toBeUndefined()
    expect(parseShareKey("share:missing-session")).toBeUndefined()
    expect(parseShareKey("other:/Users/me:ses_456")).toBeUndefined()
  })
})
