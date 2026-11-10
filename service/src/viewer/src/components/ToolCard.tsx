import { createEffect, Show } from "solid-js"
import type { ShareToolPart } from "../../../../../shared/types"
import { useDisclosure } from "../hooks/use-disclosure"
import { usePartDetail } from "../hooks/use-part-detail"
import { formatDuration } from "../lib/format"
import { previewText } from "../lib/preview"
import { DetailSkeleton } from "./DetailSkeleton"
import { DiffView } from "./DiffView"
import { JsonBlock } from "./JsonBlock"
import { SimpleCode } from "./SimpleCode"

export function ToolCard(props: {
  part: ShareToolPart
  shareId: string
  messageIndex: number
  partIndex: number
}) {
  const detail = usePartDetail(props)
  const disclosure = useDisclosure(
    `tool:${props.shareId}:${props.messageIndex}:${props.partIndex}`,
  )
  const current = () => {
    const value = detail.detail()
    return value?.type === "tool" ? value : props.part
  }
  const input = () =>
    (current().input && typeof current().input === "object" ? current().input : {}) as Record<
      string,
      any
    >
  const kind = () => current().name
  const output = () => current().output ?? ""
  const durationLabel = () => {
    const value = current().durationMs
    return value !== undefined && value >= 1000 ? formatDuration(value) : ""
  }
  const hint = () => {
    const value = input()
    switch (current().name) {
      case "bash":
        return String(value.command ?? value.cmd ?? "")
      case "read":
      case "write":
      case "edit":
        return String(value.filePath ?? value.path ?? "")
      case "grep":
      case "glob":
        return String(value.pattern ?? value.query ?? "")
      case "list":
        return String(value.path ?? "")
      case "webfetch":
        return String(value.url ?? "")
      case "task":
        return String(value.description ?? "")
      default:
        return ""
    }
  }

  createEffect(() => {
    if (disclosure.open()) detail.load()
  })

  return (
    <details
      class="tool-card"
      data-tool={current().name}
      open={disclosure.open()}
      onToggle={(event) => {
        disclosure.onToggle(event)
        if ((event.currentTarget as HTMLDetailsElement).open) detail.load()
      }}
    >
      <summary>
        <span
          class={`h-1.5 w-1.5 flex-none rounded-full ${current().status === "completed" ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <span class="tool-name">{current().name}</span>
        <Show when={hint()}>
          <span class="tool-hint">{previewText(hint(), 90)}</span>
        </Show>
        <span class="tool-meta">
          <Show when={current().status === "error"}>
            <span class="tool-status">error</span>
          </Show>
          <Show when={durationLabel()}>
            <span class="tool-duration">{durationLabel()}</span>
          </Show>
          <span class="tool-chevron" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>
      <div class="tool-body space-y-3">
        <Show when={detail.loading()}>
          <DetailSkeleton label="Loading tool output…" />
        </Show>
        <Show when={detail.failed()}>
          <div class="detail-loading">
            Details unavailable.
            <button type="button" class="text-toggle" onClick={() => detail.load()}>
              Retry
            </button>
          </div>
        </Show>
        <Show when={current().error}>
          <div class="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">
            {current().error}
          </div>
        </Show>

        <Show
          when={
            kind() === "edit" &&
            input().oldString !== undefined &&
            input().newString !== undefined
          }
        >
          <DiffView
            file={String(input().filePath ?? input().path ?? "file")}
            oldText={String(input().oldString ?? "")}
            newText={String(input().newString ?? "")}
          />
        </Show>

        <Show when={kind() === "write" && typeof input().content === "string"}>
          <SimpleCode
            file={String(input().filePath ?? input().path ?? "file")}
            code={String(input().content)}
          />
        </Show>

        <Show when={kind() === "read" && output()}>
          <SimpleCode file={String(input().filePath ?? input().path ?? "file")} code={output()} />
        </Show>

        <Show when={kind() === "bash"}>
          <div class="terminal">
            <div class="terminal-head">bash</div>
            <pre>
              <span class="text-[var(--code-tag)]">$</span> {String(input().command ?? input().cmd ?? "")}
              {output() ? `\n${output()}` : ""}
            </pre>
          </div>
        </Show>

        <Show
          when={
            !(
              (kind() === "edit" && input().oldString !== undefined) ||
              (kind() === "write" && typeof input().content === "string") ||
              (kind() === "read" && output()) ||
              kind() === "bash"
            )
          }
        >
          <JsonBlock label="input" value={input()} />
          <Show when={output()}>
            <div>
              <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                output
              </div>
              <pre class="max-h-[50vh] overflow-auto rounded-md border border-[var(--line)] bg-[var(--page)] p-3 text-xs leading-6 whitespace-pre-wrap">
                {output()}
              </pre>
            </div>
          </Show>
        </Show>
      </div>
    </details>
  )
}
