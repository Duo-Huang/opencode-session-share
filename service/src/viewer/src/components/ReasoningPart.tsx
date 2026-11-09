import { createEffect, createMemo, Show } from "solid-js"
import { useDisclosure } from "../hooks/use-disclosure"
import { usePartDetail } from "../hooks/use-part-detail"
import { formatDuration } from "../lib/format"
import { renderMarkdown } from "../markdown"
import { DetailSkeleton } from "./DetailSkeleton"
import { SparklesIcon } from "./icons"

export function ReasoningPart(props: {
  text: string
  durationMs?: number
  shareId: string
  messageIndex: number
  partIndex: number
}) {
  const detail = usePartDetail(props)
  const disclosure = useDisclosure(
    `reasoning:${props.shareId}:${props.messageIndex}:${props.partIndex}`,
  )
  const text = () => {
    const value = detail.detail()
    return value?.type === "reasoning" ? value.text : props.text
  }
  const durationMs = () => {
    const value = detail.detail()
    return value?.type === "reasoning" ? value.durationMs : props.durationMs
  }
  const html = createMemo(() => renderMarkdown(text()))

  createEffect(() => {
    if (disclosure.open()) detail.load()
  })

  return (
    <details
      class="thinking"
      open={disclosure.open()}
      onToggle={(event) => {
        disclosure.onToggle(event)
        if ((event.currentTarget as HTMLDetailsElement).open) detail.load()
      }}
    >
      <summary>
        <span class="thinking-label">
          <SparklesIcon />
          <span>Thinking</span>
          <Show when={durationMs() !== undefined && durationMs()! >= 100}>
            <span class="thinking-duration">{formatDuration(durationMs()!)}</span>
          </Show>
        </span>
        <span class="thinking-toggle">
          <span class="thinking-closed">Show details</span>
          <span class="thinking-open">Hide details</span>
        </span>
      </summary>
      <div class="thinking-body prose-share" innerHTML={html()} />
      <Show when={detail.loading()}>
        <DetailSkeleton label="Loading thinking…" />
      </Show>
      <Show when={detail.failed() && !text()}>
        <div class="detail-loading">
          Details unavailable.
          <button type="button" class="text-toggle" onClick={() => detail.load()}>
            Retry
          </button>
        </div>
      </Show>
    </details>
  )
}
