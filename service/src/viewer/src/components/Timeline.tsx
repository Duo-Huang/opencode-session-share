import { Show } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import type { ShareView, TurnItem } from "../lib/types"
import { hasAfter, hasBefore } from "../lib/share-view"
import { AssistantTurn } from "./AssistantTurn"
import { AssistantWorking } from "./AssistantWorking"
import { MessageGap } from "./MessageGap"
import { MessageView } from "./MessageView"

type AssistantItem = Extract<TurnItem, { kind: "assistant" }>
type MessageItem = Extract<TurnItem, { kind: "message" }>

export function Timeline(props: {
  view: ShareView | null
  turns: TurnItem[]
  lastTextId: string
  loadingPage: boolean
  scrollDirection: "up" | "down"
  onLoadPrevious: () => void
  onLoadNext: () => void
  onLoadGap: (start: number, end: number, direction: "up" | "down") => void
}) {
  const current = () => props.view

  return (
    <Show when={current()}>
      {(view) => (
        <main class="timeline">
          <Show when={hasBefore(view())}>
            <div class="load-edge load-before">
              <span>Earlier messages are not loaded</span>
              <button type="button" disabled={props.loadingPage} onClick={props.onLoadPrevious}>
                {props.loadingPage ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          </Show>
          <Key each={props.turns} by="key">
            {(turnAccessor) => {
              const kind = turnAccessor().kind
              if (kind === "gap") {
                const gap = turnAccessor as () => Extract<TurnItem, { kind: "gap" }>
                return (
                  <div
                    class="timeline-item timeline-gap"
                    data-gap={`${gap().start}-${gap().end}`}
                  >
                    <div class="timeline-rail">
                      <span class="timeline-line" />
                    </div>
                    <div class="timeline-content">
                      <MessageGap
                        start={gap().start}
                        end={gap().end}
                        loading={props.loadingPage}
                        onLoad={() =>
                          props.onLoadGap(gap().start, gap().end, props.scrollDirection)
                        }
                      />
                    </div>
                  </div>
                )
              }
              if (kind === "assistant") {
                const turn = turnAccessor as () => AssistantItem
                const isLast = () => props.turns.at(-1)?.key === turn().key
                return (
                  <div class="timeline-item" data-role="assistant">
                    <div class="timeline-rail">
                      <span class="timeline-icon" data-role="assistant" aria-hidden="true">
                        A
                      </span>
                      <span class="timeline-line" />
                    </div>
                    <div class="timeline-content">
                      <AssistantTurn
                        messages={turn().messages}
                        shareId={view().id}
                        lastTextId={props.lastTextId}
                        running={
                          view().session.running === true && !hasAfter(view()) && isLast()
                        }
                      />
                    </div>
                  </div>
                )
              }
              const turn = turnAccessor as () => MessageItem
              return (
                <div class="timeline-item" id={`m-${turn().index}`}>
                  <div class="timeline-rail">
                    <span class="timeline-icon" data-role={turn().message.role} aria-hidden="true">
                      {turn().message.role === "user"
                        ? "U"
                        : turn().message.role === "shell"
                          ? "$"
                          : "·"}
                    </span>
                    <span class="timeline-line" />
                  </div>
                  <div class="timeline-content">
                    <MessageView message={turn().message} shareId={view().id} />
                  </div>
                </div>
              )
            }}
          </Key>
          <Show
            when={
              view().session.running === true &&
              props.turns.at(-1)?.kind !== "assistant" &&
              !hasAfter(view())
            }
          >
            <AssistantWorking label="Waiting for the assistant…" />
          </Show>
          <Show when={hasAfter(view())}>
            <div class="load-edge load-after">
              <button type="button" disabled={props.loadingPage} onClick={props.onLoadNext}>
                {props.loadingPage ? "Loading…" : "Load more messages"}
              </button>
            </div>
          </Show>
        </main>
      )}
    </Show>
  )
}
