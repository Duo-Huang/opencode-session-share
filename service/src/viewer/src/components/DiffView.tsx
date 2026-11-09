import { createMemo, For } from "solid-js"

export function DiffView(props: { file: string; oldText: string; newText: string }) {
  const rows = createMemo(() => {
    let oldLines = props.oldText.split("\n")
    let newLines = props.newText.split("\n")
    if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines = oldLines.slice(0, -1)
    if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines = newLines.slice(0, -1)
    const max = Math.max(oldLines.length, newLines.length)
    const result: { type: "ctx" | "add" | "del"; text: string }[] = []
    for (let index = 0; index < max; index++) {
      const oldLine = oldLines[index]
      const newLine = newLines[index]
      if (oldLine === newLine) result.push({ type: "ctx", text: oldLine ?? "" })
      else {
        if (oldLine !== undefined) result.push({ type: "del", text: oldLine })
        if (newLine !== undefined) result.push({ type: "add", text: newLine })
      }
    }
    return result
  })

  return (
    <div>
      <div class="mb-1 truncate text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
        {props.file}
      </div>
      <div class="diff">
        <For each={rows()}>
          {(row) => (
            <div class={`diff-row ${row.type === "add" ? "add" : row.type === "del" ? "del" : ""}`}>
              <span class="diff-sign">{row.type === "add" ? "+" : row.type === "del" ? "-" : " "}</span>
              <span class="diff-line">{row.text || " "}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
