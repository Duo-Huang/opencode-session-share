const securityHeaders = {
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; media-src 'none'; manifest-src 'none'; upgrade-insecure-requests",
} as const

export function noStore() {
  return {
    ...securityHeaders,
    "cache-control": "no-store, no-cache, must-revalidate, private, max-age=0",
    "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store",
    "surrogate-control": "no-store",
    pragma: "no-cache",
    expires: "0",
  }
}

/**
 * The viewer shell is identical for every share and contains no share data.
 * It is safe to cache at the edge; the API and WebSocket still enforce
 * revocation per share.
 */
export function shellHeaders() {
  return {
    ...securityHeaders,
    "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
    "cdn-cache-control": "public, max-age=300, stale-while-revalidate=60",
    "cloudflare-cdn-cache-control": "public, max-age=300, stale-while-revalidate=60",
  }
}

/**
 * Public share JSON is cached at the edge only when purge is configured.
 * The browser keeps max-age=0 so it always revalidates; the edge serves the
 * fast copy. After 60s the edge keeps serving the stale copy for up to 5
 * minutes while revalidating in the background, so a large snapshot never
 * blocks a viewer on the slow tunnel after the cache is warm.
 */
export function publicApiHeaders(edgeCache: boolean) {
  if (!edgeCache) return noStore()
  return {
    ...securityHeaders,
    "cache-control": "public, max-age=0, must-revalidate",
    "cdn-cache-control": "public, max-age=60, stale-while-revalidate=300",
    "cloudflare-cdn-cache-control": "public, max-age=60, stale-while-revalidate=300",
  }
}

export function goneHeaders() {
  return {
    ...noStore(),
    "clear-site-data": '"cache"',
  }
}

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:light-dark(#fff,#0f1115);--fg:light-dark(#171717,#e5e5e5);--muted:light-dark(#737373,#a3a3a3);--line:light-dark(#e5e5e5,#262626)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:42rem;border:1px solid var(--line);border-radius:12px;padding:2rem}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
</style>
</head>
<body><main>${body}</main></body>
</html>`
}

export function notFoundPage() {
  return page("Not found", "<h1>Not found</h1><p>The requested share does not exist.</p>")
}

export function gonePage() {
  return page(
    "Share unavailable",
    "<h1>Share unavailable</h1><p>This share has been revoked or expired.</p>",
  )
}

export function errorPage(message = "Something went wrong") {
  return page("Error", `<h1>Error</h1><p>${escapeHtml(message)}</p>`)
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
