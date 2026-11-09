export function previewText(text: string, limit = 160) {
  const value = text.replace(/\s+/g, " ").trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function highlightPreview(text: string, query: string) {
  const needle = query.trim()
  if (!needle) return escapeHtml(text)
  const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (at < 0) return escapeHtml(text)
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(
    text.slice(at, at + needle.length),
  )}</mark>${escapeHtml(text.slice(at + needle.length))}`
}
