import { For, Show } from "solid-js"
import { useDisclosure } from "../hooks/use-disclosure"
import type { AssistantBlock } from "../lib/types"
import { formatDuration } from "../lib/format"
import { ReasoningPart } from "./ReasoningPart"
import { SparklesIcon, TerminalIcon } from "./icons"
import { ToolCard } from "./ToolCard"

export function ActivityGroup(props: {
  block: Extract<AssistantBlock, { kind: "activity" }>
  shareId: string
  running?: boolean
}) {
  const disclosure = useDisclosure(`activity:${props.shareId}:${props.block.key}`)
  const label = () => {
    const labels: string[] = []
    if (props.block.reasoning) labels.push("Thinking")
    if (props.block.tools) {
      labels.push(`${props.block.tools} tool${props.block.tools === 1 ? "" : "s"}`)
    }
    return labels.join(" · ")
  }

  return (
    <details class="activity-group" open={disclosure.open()} onToggle={disclosure.onToggle}>
      <summary class="activity-summary">
        <span class="activity-label">
          <Show when={props.block.reasoning > 0}>
            <SparklesIcon />
          </Show>
          <Show when={props.block.tools > 0}>
            <TerminalIcon />
          </Show>
          <span>{label()}</span>
          <Show when={props.block.durationMs > 0}>
            <span class="activity-duration">{formatDuration(props.block.durationMs)}</span>
          </Show>
          <Show when={props.running}>
            <span class="activity-running" role="status">
              <span class="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Working
            </span>
          </Show>
        </span>
        <span class="activity-toggle">
          <span class="activity-closed">Show details</span>
          <span class="activity-open">Hide details</span>
        </span>
      </summary>
      <div class="activity-body">
        <For each={props.block.parts}>
          {(entry) =>
            entry.part.type === "reasoning" ? (
              <ReasoningPart
                text={entry.part.text}
                durationMs={entry.part.durationMs}
                shareId={props.shareId}
                messageIndex={entry.messageIndex}
                partIndex={entry.partIndex}
              />
            ) : (
              <ToolCard
                part={entry.part}
                shareId={props.shareId}
                messageIndex={entry.messageIndex}
                partIndex={entry.partIndex}
              />
            )
          }
        </For>
        <Show when={props.running}>
          <div class="activity-loading" role="status">
            <span class="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Waiting for more thinking and tool output…
          </div>
        </Show>
      </div>
    </details>
  )
}
