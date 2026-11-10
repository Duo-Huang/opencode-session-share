export const SHARE_PREFIX = "share:"

export type ShareKey = {
  /** Missing on legacy keys created before endpoint-scoped storage. */
  endpoint?: string
  directory: string
  sessionID: string
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "")
}

export function shareKey(endpoint: string, directory: string, sessionID: string) {
  const normalized = normalizeEndpoint(endpoint)
  if (!normalized) return `${SHARE_PREFIX}${directory}:${sessionID}`
  return `${SHARE_PREFIX}${normalized}|${directory}|${sessionID}`
}

/**
 * New keys are `share:<endpoint>|<directory>|<sessionID>`. Legacy keys are
 * `share:<directory>:<sessionID>`; accept both so existing installs migrate
 * without losing their active share.
 */
export function parseShareKey(key: string): ShareKey | undefined {
  if (!key.startsWith(SHARE_PREFIX)) return undefined
  const rest = key.slice(SHARE_PREFIX.length)

  const firstPipe = rest.indexOf("|")
  const lastPipe = rest.lastIndexOf("|")
  if (firstPipe > 0 && lastPipe > firstPipe) {
    const endpoint = rest.slice(0, firstPipe)
    const directory = rest.slice(firstPipe + 1, lastPipe)
    const sessionID = rest.slice(lastPipe + 1)
    if (endpoint && directory && sessionID) return { endpoint, directory, sessionID }
  }

  const separator = rest.lastIndexOf(":")
  if (separator <= 0) return undefined
  const directory = rest.slice(0, separator)
  const sessionID = rest.slice(separator + 1)
  if (!directory || !sessionID) return undefined
  return { directory, sessionID }
}
