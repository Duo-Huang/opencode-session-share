import { Show } from "solid-js"
import { ArrowDownIcon, ArrowUpIcon } from "./icons"

export function ViewControls(props: {
  newMessages: boolean
  loadingTail: boolean
  onLoadTail: () => void
  showTop: boolean
  canLoadBefore: boolean
  onGoToFirstPage: () => void
  showBottom: boolean
  canLoadAfter: boolean
  onGoToBottom: () => void
}) {
  return (
    <>
      <Show when={props.newMessages}>
        <button
          type="button"
          class="new-messages no-print"
          disabled={props.loadingTail}
          aria-busy={props.loadingTail}
          onClick={props.onLoadTail}
        >
          <Show when={props.loadingTail} fallback="New messages">
            <span class="spinner" aria-hidden="true" />
            Loading…
          </Show>
        </button>
      </Show>

      <div class="scroll-controls no-print">
        <button
          type="button"
          class={`scroll-control ${
            props.showTop || props.canLoadBefore ? "" : "pointer-events-none opacity-0"
          }`}
          aria-label="Back to top"
          title="Back to top"
          onClick={props.onGoToFirstPage}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          class={`scroll-control ${
            props.showBottom || props.canLoadAfter ? "" : "pointer-events-none opacity-0"
          }`}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          onClick={props.onGoToBottom}
        >
          <ArrowDownIcon />
        </button>
      </div>
    </>
  )
}
