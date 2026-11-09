import { Show } from "solid-js"
import { REPO_URL } from "../lib/constants"
import { formatDate } from "../lib/format"
import type { ShareView } from "../lib/types"
import { LockIcon } from "./icons"

export function ShareFooter(props: {
  share: ShareView
  detailsOmitted: boolean
  bodyTruncated: boolean
}) {
  return (
    <footer class="share-footer">
      <div class="footer-meta">
        <div class="footer-facts">
          <div class="footer-fact">
            <span>Created</span>
            <strong>{formatDate(props.share.createdAt)}</strong>
          </div>
          <div class="footer-fact">
            <span>Updated</span>
            <strong>{formatDate(props.share.updatedAt)}</strong>
          </div>
          <div class="footer-fact">
            <span>Expires</span>
            <strong>{formatDate(props.share.expiresAt)}</strong>
          </div>
        </div>
        <div class="footer-visibility">
          <LockIcon />
          Read-only
          <span class="dot">·</span>
          Anyone with link
        </div>
      </div>
      <div class="footer-notes">
        <div class="footer-note-copy">
          <p>
            This page uses OpenCode&apos;s active context. Earlier history is represented by the
            compaction summary.
            <Show when={props.detailsOmitted}> Tool and thinking details load on demand.</Show>
          </p>
          <Show when={props.bodyTruncated}>
            <span class="footer-warning">Some message text could not be included</span>
          </Show>
        </div>
        <p class="note-source">
          Open source on{" "}
          <a class="repo-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
          .
        </p>
      </div>
    </footer>
  )
}
