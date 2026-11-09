import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useDisclosure } from "../hooks/use-disclosure"
import { renderMarkdown } from "../markdown"

export function TextPart(props: { id: string; text: string; expand?: boolean; shareId: string }) {
  const key = `text:${props.shareId}:${props.id}`
  const disclosure = useDisclosure(key, props.expand === true)
  const expanded = disclosure.open
  const [overflow, setOverflow] = createSignal(false)
  const html = createMemo(() => renderMarkdown(props.text))
  let ref: HTMLDivElement | undefined

  const measure = () => {
    if (!ref || expanded()) return
    setOverflow(ref.scrollHeight > ref.clientHeight + 2)
  }

  onMount(() => {
    measure()
    if (!ref) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(ref)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    void props.text
    if (props.expand && !disclosure.hasStoredValue()) disclosure.set(true)
    queueMicrotask(measure)
  })

  const toggle = () => {
    disclosure.toggle()
    queueMicrotask(measure)
  }

  return (
    <div
      class="assistant-text"
      id={props.id}
      data-expanded={expanded() ? true : undefined}
      data-overflow={overflow() ? true : undefined}
    >
      <div ref={ref} class="prose-share" innerHTML={html()} />
      <Show when={overflow() || expanded()}>
        <button
          type="button"
          class="text-toggle text-more"
          data-expanded={expanded() ? true : undefined}
          onClick={toggle}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      </Show>
    </div>
  )
}
