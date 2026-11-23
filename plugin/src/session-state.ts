/**
 * Session clock helpers shared by the event-driven sync and the low-frequency
 * catch-up. OpenCode versions differ in how they expose `DateTimeUtc`, so the
 * readers accept numbers, Date objects, and Effect epoch objects.
 */
export type SessionTime = {
  updated?: unknown
  idle?: unknown
  busy?: unknown
}

export function millis(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === "object") {
    const record = value as { epochMillis?: unknown; epochMilliseconds?: unknown }
    if (typeof record.epochMillis === "number") return record.epochMillis
    if (typeof record.epochMilliseconds === "number") return record.epochMilliseconds
  }
  return undefined
}

export function sessionTime(info: unknown): SessionTime | undefined {
  return (info as { time?: SessionTime } | undefined)?.time
}

/** Matches the TUI: a start marker newer than the idle marker means running. */
export function persistedRunning(time: SessionTime | undefined): boolean | undefined {
  const busy = millis(time?.busy)
  if (busy === undefined) return undefined
  return busy > (millis(time?.idle) ?? 0)
}

/** Latest observable session change used to decide whether a catch-up is due. */
export function sessionMarker(time: SessionTime | undefined): number | undefined {
  const updated = millis(time?.updated)
  const idle = millis(time?.idle)
  if (updated === undefined) return idle
  if (idle === undefined) return updated
  return Math.max(updated, idle)
}

export function needsCatchUp(
  lastSynced: number | undefined,
  marker: number | undefined,
  running: boolean | undefined,
): boolean {
  if (running === true) return false
  if (marker === undefined) return false
  return lastSynced === undefined || marker > lastSynced
}
