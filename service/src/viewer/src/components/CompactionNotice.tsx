import { createMemo, Show } from "solid-js"
import { renderMarkdown } from "../markdown"
import { useDisclosure } from "../hooks/use-disclosure"

export function CompactionNotice(props: { text: string; shareId: string; time: number }) {
  const disclosure = useDisclosure(`compaction:${props.shareId}:${props.time}`)
  const html = createMemo(() => renderMarkdown(props.text))

  return (
    <details class="compaction" open={disclosure.open()} onToggle={disclosure.onToggle}>
      <summary>
        <span class="compaction-line" />
        <span class="compaction-label">Context compacted</span>
        <span class="compaction-toggle">
          <span class="compaction-closed">Show summary</span>
          <span class="compaction-open">Hide summary</span>
        </span>
        <span class="compaction-line" />
      </summary>
      <div class="compaction-body prose-share">
        <Show when={props.text.trim()} fallback={<p>No summary available.</p>}>
          <div innerHTML={html()} />
        </Show>
      </div>
    </details>
  )
}
