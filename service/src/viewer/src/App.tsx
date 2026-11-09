import { Show } from "solid-js"
import { Directory } from "./components/Directory"
import { LivePill } from "./components/LivePill"
import { ShareFooter } from "./components/ShareFooter"
import { ShareHeader } from "./components/ShareHeader"
import { StatusPanels } from "./components/StatusPanels"
import { Timeline } from "./components/Timeline"
import { ViewControls } from "./components/ViewControls"
import { DisclosureProvider } from "./hooks/use-disclosure"
import { useDirectory } from "./hooks/use-directory"
import { useShare } from "./hooks/use-share"

export function App() {
  const id = location.pathname.split("/").filter(Boolean).pop() ?? ""

  let anchorId = () => ""
  const share = useShare(id, { getAnchorId: () => anchorId() })
  const directory = useDirectory({
    view: share.view,
    scrollTick: share.scrollTick,
    jumpToTarget: share.jumpToTarget,
  })
  anchorId = () => directory.activeId()

  return (
    <DisclosureProvider>
      <div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
        <LivePill state={share.liveState()} title={share.liveTitle()} />
        <ShareHeader
          share={share.view}
          stats={share.stats}
          models={share.models}
          status={share.status}
        />
        <StatusPanels
          status={share.status}
          error={share.error}
          hasShare={() => share.view() !== null}
        />

        <Timeline
          view={share.view()}
          turns={share.displayTurns()}
          lastTextId={share.lastTextId()}
          loadingPage={share.loadingPage()}
          scrollDirection={share.scrollDirection()}
          onLoadPrevious={() => void share.loadPreviousPage()}
          onLoadNext={() => void share.loadNextPage()}
          onLoadGap={(start, end, direction) => void share.loadGap(start, end, direction)}
        />

        <Show when={share.view()}>
          {(current) => (
            <Show when={share.status() !== "revoked" && share.status() !== "error"}>
              <ShareFooter
                share={current()}
                detailsOmitted={share.detailsOmitted()}
                bodyTruncated={share.bodyTruncated()}
              />
            </Show>
          )}
        </Show>

        <Directory
          directory={directory}
          shareId={id}
          showContents={share.stats().messages > 30}
          jumpToTarget={share.jumpToTarget}
        />

        <ViewControls
          newMessages={share.newMessages()}
          loadingTail={share.loadingTail()}
          onLoadTail={() => void share.loadTail()}
          showTop={share.showTop()}
          canLoadBefore={share.canLoadBefore()}
          onGoToFirstPage={() => void share.goToFirstPage()}
          showBottom={share.showBottom()}
          canLoadAfter={share.canLoadAfter()}
          onGoToBottom={share.goToBottom}
        />
      </div>
    </DisclosureProvider>
  )
}
