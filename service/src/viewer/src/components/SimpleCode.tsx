import { createMemo } from "solid-js"
import { highlightCode, languageFromFile } from "../markdown"

export function SimpleCode(props: { file: string; code: string }) {
  const code = () =>
    props.code.length > 200_000 ? `${props.code.slice(0, 200_000)}\n… [truncated]` : props.code
  const html = createMemo(() => highlightCode(code(), languageFromFile(props.file)))

  return (
    <figure class="code-block" data-code-scope>
      <figcaption>
        <span class="code-file truncate">{props.file}</span>
        <button type="button" class="copy-button" data-copy>
          copy
        </button>
      </figcaption>
      <pre>
        <code class="hljs" innerHTML={html()} />
      </pre>
    </figure>
  )
}
