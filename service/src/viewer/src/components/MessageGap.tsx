import { createEffect, createSignal, onCleanup, onMount } from "solid-js"

export function MessageGap(props: {
  start: number
  end: number
  loading: boolean
  onLoad: () => void
}) {
  let element: HTMLDivElement | undefined
  const [visible, setVisible] = createSignal(false)

  onMount(() => {
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "0px", threshold: 0 },
    )
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (!visible() || props.loading) return
    // The gap only loads when it actually enters the viewport. Jump-time
    // auto-fill already handled the adjacent page.
    props.onLoad()
  })

  return (
    <div
      ref={element}
      class="load-edge message-gap"
      data-gap={`${props.start}-${props.end}`}
      role="status"
    >
      <span>{props.end - props.start} messages not loaded</span>
      <button type="button" disabled={props.loading} onClick={() => props.onLoad()}>
        {props.loading ? "Loading…" : "Load messages"}
      </button>
    </div>
  )
}
