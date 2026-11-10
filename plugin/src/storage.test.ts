import { describe, expect, test } from "bun:test"
import { endpointFromShareUrl, parseShareKey, shareKey } from "./storage"

describe("share storage keys", () => {
  test("round-trips endpoint, directory, and session", () => {
    const key = shareKey("https://share.example.com", "/Users/me/project", "ses_123")
    expect(key).toBe("share:https://share.example.com|/Users/me/project|ses_123")
    expect(parseShareKey(key)).toEqual({
      endpoint: "https://share.example.com",
      directory: "/Users/me/project",
      sessionID: "ses_123",
    })
  })

  test("accepts legacy directory keys", () => {
    expect(parseShareKey("share:/Users/me/project:ses_123")).toEqual({
      directory: "/Users/me/project",
      sessionID: "ses_123",
    })
  })

  test("falls back to a legacy key without an endpoint", () => {
    expect(shareKey("", "/Users/me/project", "ses_123")).toBe("share:/Users/me/project:ses_123")
  })

  test("keeps separate keys for different endpoints", () => {
    expect(shareKey("https://a.example", "/work", "ses_1")).not.toBe(
      shareKey("https://b.example", "/work", "ses_1"),
    )
  })

  test("recovers a service base path from a share URL", () => {
    expect(endpointFromShareUrl("https://share.example.com/s/share_1")).toBe(
      "https://share.example.com",
    )
    expect(endpointFromShareUrl("https://share.example.com/base/s/share_1")).toBe(
      "https://share.example.com/base",
    )
    expect(endpointFromShareUrl("not a url")).toBeUndefined()
  })

  test("ignores unrelated keys", () => {
    expect(parseShareKey("share_consent")).toBeUndefined()
    expect(parseShareKey("share:missing-session")).toBeUndefined()
    expect(parseShareKey("other:/Users/me:ses_456")).toBeUndefined()
  })
})
