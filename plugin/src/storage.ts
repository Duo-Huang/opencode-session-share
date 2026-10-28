export const SHARE_PREFIX = "share:"

export type ShareKey = {
  directory: string
  sessionID: string
}

export function shareKey(directory: string, sessionID: string) {
  return `${SHARE_PREFIX}${directory}:${sessionID}`
}

/**
 * Storage keys are scoped by the directory where the share was created.
 * The TUI can start in a different directory after a restart, so this parser
 * must recover the session independently of the current location.
 */
export function parseShareKey(key: string): ShareKey | undefined {
  if (!key.startsWith(SHARE_PREFIX)) return undefined
  const rest = key.slice(SHARE_PREFIX.length)
  const separator = rest.lastIndexOf(":")
  if (separator <= 0) return undefined

  const directory = rest.slice(0, separator)
  const sessionID = rest.slice(separator + 1)
  if (!directory || !sessionID) return undefined
  return { directory, sessionID }
}
