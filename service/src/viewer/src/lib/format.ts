export function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatCost(value: number) {
  if (!value) return "$0"
  return `$${value.toFixed(value < 0.01 ? 5 : 4)}`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
