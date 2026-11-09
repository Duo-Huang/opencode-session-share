import type { LoadedRange } from "../view-state"
import type {
  PublicLiveUpdate,
  PublicMessagePage,
  PublicShareResponse,
  ShareAssistantMessage,
  ShareAssistantPart,
  ShareIndexItem,
  ShareMessage,
} from "../../../../../shared/types"

export type PublicShare = PublicShareResponse
export type PageData = PublicMessagePage
export type LiveUpdate = PublicLiveUpdate
export type { LoadedRange } from "../view-state"
export type SearchResult = ShareIndexItem
export type Status = "loading" | "live" | "reconnecting" | "revoked" | "error"

/** Client-side sparse view of a share. */
export type ShareView = Omit<PublicShare, "messages" | "page"> & {
  messages: Map<number, ShareMessage>
  ranges: LoadedRange[]
  total: number
}

export type DirectoryItem = ShareIndexItem & {
  label: string
}

export type AssistantEntry = {
  message: ShareAssistantMessage
  index: number
}

export type AssistantActivityPart = {
  messageIndex: number
  partIndex: number
  part: Exclude<ShareAssistantPart, { type: "text" }>
}

export type AssistantBlock =
  | { kind: "text"; id: string; text: string }
  | {
      kind: "activity"
      key: string
      parts: AssistantActivityPart[]
      reasoning: number
      tools: number
      durationMs: number
    }

export type TurnItem =
  | { kind: "assistant"; key: string; index: number; messages: AssistantEntry[] }
  | { kind: "message"; key: string; index: number; message: ShareMessage }
  | { kind: "gap"; key: string; start: number; end: number }
