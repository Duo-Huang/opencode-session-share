import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { DirectoryItem, ShareView } from "../lib/types"

export function useDirectory(options: {
  view: Accessor<ShareView | null>
  scrollTick: Accessor<number>
  jumpToTarget: (target: string, messageIndex: number) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [activeId, setActiveId] = createSignal("")
  const [hovered, setHovered] = createSignal<{ item: DirectoryItem; top: number } | null>(null)
  let rail: HTMLElement | undefined
  let button: HTMLButtonElement | undefined
  let panel: HTMLElement | undefined

  const items = createMemo<DirectoryItem[]>(() =>
    (options.view()?.index ?? []).map((item) => ({
      ...item,
      label: item.role === "user" ? "You" : "Agent",
    })),
  )

  createEffect(() => {
    options.scrollTick()
    const current = items()
    if (!current.length) {
      setActiveId("")
      return
    }
    let active = ""
    for (const item of current) {
      const element = document.getElementById(item.id)
      if (!element) continue
      if (!active) active = item.id
      if (element.getBoundingClientRect().top <= 140) active = item.id
      else break
    }
    setActiveId(active)
  })

  createEffect(() => {
    const active = activeId()
    if (!active) return
    queueMicrotask(() => {
      const currentRail = rail
      const item = currentRail?.querySelector<HTMLElement>("[data-active]")
      if (!currentRail || !item) return
      const railRect = currentRail.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      if (itemRect.top < railRect.top) currentRail.scrollTop -= railRect.top - itemRect.top + 8
      else if (itemRect.bottom > railRect.bottom) {
        currentRail.scrollTop += itemRect.bottom - railRect.bottom + 8
      }
    })
  })

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panel?.contains(target) || button?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  const jump = (item: Pick<DirectoryItem, "id" | "messageIndex">) => {
    setHovered(null)
    options.jumpToTarget(item.id, item.messageIndex)
  }

  const showHovered = (item: DirectoryItem, top: number) => setHovered({ item, top })

  return {
    items,
    activeId,
    open,
    setOpen,
    hovered,
    setHovered,
    showHovered,
    jump,
    setRail: (element: HTMLElement) => (rail = element),
    setButton: (element: HTMLButtonElement) => (button = element),
    setPanel: (element: HTMLElement) => (panel = element),
  }
}
