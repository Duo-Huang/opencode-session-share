export const REPO_URL = "https://github.com/Duo-Huang/opencode-session-share"

export const reconnectDelays = [1000, 2000, 5000, 10000, 30000]

// Page-count policy for gap loading, not a byte limit. Increase only if the
// server page budget is small; very large pages should stay at 1-2.
export const AUTO_FILL_MAX_PAGES = 2
export const STATUS_POLL_MS = 60_000
export const STATUS_RETRY_MS = 5_000
export const STATUS_MAX_MS = 60_000
export const WS_WATCHDOG_MS = 75_000
