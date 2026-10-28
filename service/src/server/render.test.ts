import { describe, expect, test } from "bun:test"
import { goneHeaders, noStore, publicApiHeaders, shellHeaders } from "./render"

describe("cache headers", () => {
  test("the viewer shell is browser- and edge-cacheable", () => {
    const headers = shellHeaders()
    expect(headers["cache-control"]).toContain("public")
    expect(headers["cache-control"]).toContain("max-age=60")
    expect(headers["cache-control"]).toContain("s-maxage=300")
    expect(headers["cdn-cache-control"]).toContain("public")
    expect(headers["cdn-cache-control"]).toContain("max-age=300")
    expect(headers["cache-control"]).not.toContain("no-store")
  })

  test("the public API is edge-cacheable only when purge is enabled", () => {
    const cached = publicApiHeaders(true)
    expect(cached["cache-control"]).toBe("public, max-age=0, must-revalidate")
    expect(cached["cdn-cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300")
    expect(cached["cloudflare-cdn-cache-control"]).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    )
    expect(cached["cache-control"]).not.toContain("no-store")

    const uncached = publicApiHeaders(false)
    expect(uncached["cache-control"]).toContain("no-store")
    expect(uncached["cdn-cache-control"]).toBe("no-store")
  })

  test("410 responses are never cached and clear the browser cache", () => {
    expect(noStore()["cache-control"]).toContain("no-store")
    expect(goneHeaders()["cache-control"]).toContain("no-store")
    expect(goneHeaders()["clear-site-data"]).toBe('"cache"')
  })
})
