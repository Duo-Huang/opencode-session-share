export type ViewAnchor = {
  id: string
  /** Global message index parsed from the DOM id. */
  index: number
  /** Element top relative to the viewport at capture time. */
  offset: number
}

/**
 * Captures the message currently at the top of the reader's viewport. The
 * active directory item is the same anchor used by the Contents rail.
 */
export function captureAnchor(id: string): ViewAnchor | undefined {
  if (!id) return undefined
  const match = /^[mp]-(\d+)/.exec(id)
  if (!match) return undefined
  const element = document.getElementById(id)
  if (!element) return undefined
  return {
    id,
    index: Number(match[1]),
    offset: element.getBoundingClientRect().top,
  }
}

/**
 * Restores the captured element to the same viewport offset. Returns false
 * when the element is not currently rendered, so the caller can load the page
 * containing it.
 */
export function restoreAnchorInDom(anchor: ViewAnchor) {
  const element = document.getElementById(anchor.id)
  if (!element) return false
  window.scrollBy({
    top: element.getBoundingClientRect().top - anchor.offset,
    behavior: "auto",
  })
  return true
}
