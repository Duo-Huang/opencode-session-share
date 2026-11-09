import { createMemo } from "solid-js"

export function JsonBlock(props: { label: string; value: unknown }) {
  const text = createMemo(() => {
    let value = ""
    try {
      value = JSON.stringify(props.value, null, 2)
    } catch {
      value = String(props.value)
    }
    if (value.length > 80_000) value = `${value.slice(0, 80_000)}\n… [truncated]`
    return value
  })

  return (
    <div>
      <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
        {props.label}
      </div>
      <pre class="max-h-[40vh] overflow-auto rounded-md border border-[var(--line)] bg-[var(--page)] p-3 text-xs leading-6 whitespace-pre-wrap">
        {text()}
      </pre>
    </div>
  )
}
