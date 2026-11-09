import { createMemo, For, Show } from "solid-js"
import type { AssistantEntry } from "../lib/types"
import { formatCost, formatDate, formatNumber } from "../lib/format"
import { buildAssistantBlocks, turnMeta } from "../lib/turns"
import { ActivityGroup } from "./ActivityGroup"
import { AssistantWorking } from "./AssistantWorking"
import { TextPart } from "./TextPart"

export function AssistantTurn(props: {
  messages: AssistantEntry[]
  shareId: string
  lastTextId: string
  running?: boolean
}) {
  const blocks = createMemo(() => buildAssistantBlocks(props.messages))
  const meta = createMemo(() => turnMeta(props.messages))
  const hasText = () => blocks().some((block) => block.kind === "text")
  const toolCount = () =>
    blocks().reduce((count, block) => count + (block.kind === "activity" ? block.tools : 0), 0)
  const hasTokens = () => {
    const tokens = meta().tokens
    return tokens.input + tokens.output + tokens.reasoning > 0
  }

  return (
    <div class="assistant-turn">
      <For each={blocks()}>
        {(block, blockIndex) =>
          block.kind === "text" ? (
            <TextPart
              id={block.id}
              text={block.text}
              expand={block.id === props.lastTextId}
              shareId={props.shareId}
            />
          ) : (
            <ActivityGroup
              block={block}
              shareId={props.shareId}
              running={props.running === true && blockIndex() === blocks().length - 1}
            />
          )
        }
      </For>

      <Show when={hasText()}>
        <div class="assistant-meta">
          <Show when={meta().agent}>
            <span>agent {meta().agent}</span>
          </Show>
          <Show when={meta().model}>
            <span>
              {meta().model!.providerID}/{meta().model!.id}
            </span>
          </Show>
          <Show when={meta().cost > 0}>
            <span>{formatCost(meta().cost)}</span>
          </Show>
          <Show when={hasTokens()}>
            <span>{formatNumber(meta().tokens.input + meta().tokens.output)} tokens</span>
          </Show>
          <Show when={meta().completed !== undefined && !props.running}>
            <span>{formatDate(meta().completed!)}</span>
          </Show>
        </div>
      </Show>

      <Show when={props.running}>
        <AssistantWorking label="Still working…" />
      </Show>

      <Show when={!props.running && !hasText() && toolCount() > 0}>
        <div class="activity-note">
          Tool-only response · {toolCount()} tool call{toolCount() === 1 ? "" : "s"}
        </div>
      </Show>
    </div>
  )
}
