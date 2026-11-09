import { createMemo, For, Show } from "solid-js"
import type { ShareMessage } from "../../../../../shared/types"
import { formatDate } from "../lib/format"
import { renderMarkdown } from "../markdown"
import { CompactionNotice } from "./CompactionNotice"

function UserMessage(props: { message: Extract<ShareMessage, { role: "user" }> }) {
  const html = createMemo(() => renderMarkdown(props.message.text))

  return (
    <div class="bubble-user">
      <div class="prose-share" innerHTML={html()} />
      <Show when={props.message.files?.length}>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <For each={props.message.files}>
            {(file) => (
              <span class="rounded-md border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)]">
                {file.name || "attachment"} · {file.mime}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="mt-2 text-[11px] text-[var(--ink-muted)]">{formatDate(props.message.time)}</div>
    </div>
  )
}

export function MessageView(props: { message: ShareMessage; shareId: string }) {
  if (props.message.role === "user") return <UserMessage message={props.message} />

  if (props.message.role === "assistant") return null

  if (props.message.role === "shell") {
    return (
      <div class="terminal">
        <div class="terminal-head">shell · {props.message.status}</div>
        <pre>
          <span class="text-emerald-400">$</span> {props.message.command}
          {props.message.output ? `\n${props.message.output}` : ""}
        </pre>
        <Show when={props.message.exit !== undefined}>
          <div class="border-t border-[#21262d] px-3 py-1.5 text-[11px] text-[#9ca3af]">
            exit {String(props.message.exit)}
          </div>
        </Show>
      </div>
    )
  }

  if (props.message.role === "notice" && props.message.kind === "compaction") {
    return (
      <CompactionNotice
        text={props.message.text}
        shareId={props.shareId}
        time={props.message.time}
      />
    )
  }

  return (
    <div class="flex items-center gap-3 py-2 text-xs text-[var(--ink-muted)]">
      <span class="h-px flex-1 bg-[var(--line)]" />
      <span>{props.message.kind}</span>
      <span class="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}
