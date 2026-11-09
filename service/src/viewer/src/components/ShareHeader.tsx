import { Show, type Accessor } from "solid-js"
import type { ShareStats } from "../../../../../shared/types"
import { useTheme } from "../hooks/use-theme"
import { REPO_URL } from "../lib/constants"
import { formatCost, formatNumber } from "../lib/format"
import type { ShareView, Status } from "../lib/types"
import { GitHubIcon } from "./icons"

export function ShareHeader(props: {
  share: Accessor<ShareView | null>
  stats: Accessor<ShareStats>
  models: Accessor<string[]>
  status: Accessor<Status>
}) {
  const theme = useTheme()

  return (
    <header class="mb-7">
      <div class="mb-4 flex items-center gap-3">
        <div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
          <span>OpenCode session</span>
          <span class="text-[var(--line-strong)]">/</span>
          <a
            class="repo-link no-print inline-flex items-center gap-1 normal-case tracking-normal"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="Open the project on GitHub"
          >
            <GitHubIcon />
            <span>GitHub</span>
          </a>
        </div>
        <button
          type="button"
          class="theme-toggle no-print grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
          aria-label={`Theme: ${theme.currentOption().label}. Click to switch to ${theme.nextOption().label}.`}
          title={`Theme: ${theme.currentOption().label} (click for ${theme.nextOption().label})`}
          onClick={theme.cycle}
        >
          {theme.currentOption().icon()}
        </button>
      </div>

      <Show
        when={props.share()}
        fallback={
          <Show when={props.status() !== "revoked" && props.status() !== "error"}>
            <div class="h-10 w-2/3 animate-pulse rounded bg-[var(--page-soft)]" />
          </Show>
        }
      >
        {(current) => (
          <>
            <h1 class="mb-4 line-clamp-3 text-3xl font-medium leading-tight tracking-[-0.045em] sm:text-4xl">
              {current().title}
            </h1>
            <div class="session-card">
              <div class="session-identity">
                <Show when={props.models().length > 0}>
                  <span class="eyebrow">Model</span>
                  <div class="model" title={props.models().join(" · ")}>
                    {props.models().join(" · ")}
                  </div>
                </Show>
                <div class="identity-chips">
                  <Show when={current().session.agent}>
                    <span class="pill">
                      <span>Agent</span>
                      {current().session.agent}
                    </span>
                  </Show>
                  <span class="pill">
                    <span>Version</span>
                    OpenCode {current().source.version}
                  </span>
                </div>
              </div>
              <div class="stat-strip">
                <div class="stat">
                  <span class="stat-label">Messages</span>
                  <span class="stat-value">{props.stats().messages}</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Tools</span>
                  <span class="stat-value">{props.stats().tools}</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Tokens</span>
                  <span class="stat-value">
                    {formatNumber(props.stats().tokens.input + props.stats().tokens.output)}
                  </span>
                </div>
                <div class="stat">
                  <span class="stat-label">Cost</span>
                  <span class="stat-value">{formatCost(props.stats().cost)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </Show>
    </header>
  )
}
