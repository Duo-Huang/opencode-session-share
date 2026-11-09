import { For, Show } from "solid-js"
import { useSearch } from "../hooks/use-search"
import type { useDirectory } from "../hooks/use-directory"
import { formatDate } from "../lib/format"
import { highlightPreview } from "../lib/preview"

export function Directory(props: {
  directory: ReturnType<typeof useDirectory>
  shareId: string
  showContents: boolean
  jumpToTarget: (target: string, messageIndex: number) => void
}) {
  const directory = props.directory
  const search = useSearch(props.shareId)

  const jumpSearchResult = (result: { id: string; messageIndex: number }) => {
    directory.setOpen(false)
    props.jumpToTarget(result.id, result.messageIndex)
  }

  return (
    <>
      <Show when={directory.items().length > 1}>
        <nav ref={directory.setRail} class="directory-rail no-print" aria-label="Message directory">
          <For each={directory.items()}>
            {(item) => (
              <button
                type="button"
                class="directory-item"
                data-role={item.role}
                data-active={directory.activeId() === item.id ? true : undefined}
                aria-label={`Jump to ${item.label}: ${item.preview}`}
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  directory.showHovered(item, rect.top + rect.height / 2)
                }}
                onMouseLeave={() => directory.setHovered(null)}
                onClick={() => directory.jump(item)}
              >
                <span class="directory-tick" />
              </button>
            )}
          </For>
        </nav>
      </Show>

      <Show when={props.showContents}>
        <button
          ref={directory.setButton}
          type="button"
          class="directory-button no-print"
          aria-expanded={directory.open()}
          onClick={() => directory.setOpen((value) => !value)}
        >
          Contents
        </button>
        <Show when={directory.open()}>
          <aside
            ref={directory.setPanel}
            class="directory-panel no-print"
            aria-label="Message directory"
          >
            <div class="directory-panel-head">
              <span>Contents</span>
              <button
                type="button"
                aria-label="Close contents"
                onClick={() => directory.setOpen(false)}
              >
                ×
              </button>
            </div>
            <div class="directory-search">
              <input
                type="search"
                placeholder="Search user and agent messages"
                aria-label="Search user and agent messages"
                value={search.query()}
                onInput={(event) => search.onInput(event.currentTarget.value)}
              />
              <Show when={search.searching()}>
                <span class="directory-search-state">…</span>
              </Show>
            </div>
            <div class="directory-panel-list">
              <Show
                when={search.query().trim()}
                fallback={
                  <For each={directory.items()}>
                    {(item) => (
                      <button
                        type="button"
                        class="directory-entry"
                        data-active={directory.activeId() === item.id ? true : undefined}
                        onClick={() => {
                          directory.jump(item)
                          directory.setOpen(false)
                        }}
                      >
                        <span class="directory-entry-head">
                          <span class="directory-entry-role">{item.label}</span>
                          <span class="directory-entry-time">{formatDate(item.time)}</span>
                        </span>
                        <span class="directory-entry-preview">{item.preview}</span>
                      </button>
                    )}
                  </For>
                }
              >
                <Show
                  when={search.results().length > 0}
                  fallback={
                    <div class="directory-empty">
                      {search.searching() ? "Searching…" : "No matches"}
                    </div>
                  }
                >
                  <For each={search.results()}>
                    {(result) => (
                      <button
                        type="button"
                        class="directory-entry"
                        onClick={() => jumpSearchResult(result)}
                      >
                        <span class="directory-entry-head">
                          <span class="directory-entry-role">
                            {result.role === "user" ? "You" : "Agent"}
                          </span>
                          <span class="directory-entry-time">{formatDate(result.time)}</span>
                        </span>
                        <span
                          class="directory-entry-preview"
                          innerHTML={highlightPreview(result.preview, search.query())}
                        />
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </aside>
        </Show>
      </Show>

      <Show when={directory.hovered()}>
        {(hover) => (
          <div class="directory-preview no-print" style={{ top: `${hover().top}px` }}>
            <div class="directory-preview-role">{hover().item.label}</div>
            <p class="directory-preview-text">{hover().item.preview}</p>
            <div class="directory-preview-time">{formatDate(hover().item.time)}</div>
          </div>
        )}
      </Show>
    </>
  )
}
