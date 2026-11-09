import { For, Show, type Accessor } from "solid-js"
import type { Status } from "../lib/types"
import { AlertIcon, LockIcon } from "./icons"

export function StatusPanels(props: {
  status: Accessor<Status>
  error: Accessor<string>
  hasShare: Accessor<boolean>
}) {
  return (
    <>
      <Show when={props.status() === "revoked"}>
        <div class="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--page-soft)] px-6 py-10 text-center sm:px-10 sm:py-12">
          <div class="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)]">
            <LockIcon />
          </div>
          <h2 class="mb-2 text-lg font-medium">This share is no longer available</h2>
          <p class="text-sm leading-6 text-[var(--ink-muted)]">
            It may have been unshared or expired.
          </p>
        </div>
      </Show>

      <Show when={props.status() === "error"}>
        <div class="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--page-soft)] px-6 py-10 text-center sm:px-10 sm:py-12">
          <div class="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)]">
            <AlertIcon />
          </div>
          <h2 class="mb-2 text-lg font-medium">Unable to load this share</h2>
          <p class="text-sm leading-6 text-[var(--ink-muted)]">
            {props.error() || "Unknown error"}
          </p>
        </div>
      </Show>

      <Show
        when={
          !props.hasShare() && props.status() !== "revoked" && props.status() !== "error"
        }
      >
        <div class="space-y-4">
          <For each={[1, 2, 3]}>
            {() => <div class="h-24 animate-pulse rounded-xl bg-[var(--page-soft)]" />}
          </For>
        </div>
      </Show>
    </>
  )
}
