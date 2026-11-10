export type ModelRef = {
  providerID: string
  id: string
  variant?: string
}

export type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache?: {
    read: number
    write: number
  }
}

export type ShareFile = {
  name?: string
  mime: string
}

export type ShareUserMessage = {
  role: "user"
  time: number
  text: string
  files?: ShareFile[]
}

export type ShareTextPart = {
  type: "text"
  text: string
}

export type ShareReasoningPart = {
  type: "reasoning"
  text: string
  durationMs?: number
}

export type ShareToolPart = {
  type: "tool"
  name: string
  status: "completed" | "error"
  /** Missing when details were omitted from the stored snapshot. */
  input?: unknown
  output?: string
  error?: string
  durationMs?: number
}

export type ShareAssistantPart = ShareTextPart | ShareReasoningPart | ShareToolPart

export type ShareAssistantMessage = {
  role: "assistant"
  time: number
  completed?: number
  agent?: string
  model?: ModelRef
  content: ShareAssistantPart[]
  cost?: number
  tokens?: TokenUsage
}

export type ShareShellMessage = {
  role: "shell"
  time: number
  command: string
  output?: string
  exit?: number | string
  status: "exited" | "timeout" | "killed"
}

export type ShareNotice = {
  role: "notice"
  kind: "synthetic" | "system" | "compaction"
  time: number
  text: string
}

export type ShareMessage = ShareUserMessage | ShareAssistantMessage | ShareShellMessage | ShareNotice

export type SharePrivacy = {
  redacted?: string[]
  dropped?: string[]
  /** Legacy aggregate flag. New viewers use the two flags below. */
  truncated?: boolean
  /** Tool/thinking bodies are available through the detail endpoint. */
  detailsOmitted?: boolean
  /** A hard limit cut visible user/assistant text. Should remain false. */
  bodyTruncated?: boolean
}

export type ShareIndexItem = {
  /** DOM target id, for example `m-12` or `p-12-1`. */
  id: string
  role: "user" | "assistant"
  time: number
  preview: string
  /** Snapshot message index used to load the page containing the target. */
  messageIndex: number
}

export type SharePageInfo = {
  start: number
  end: number
  total: number
  hasBefore: boolean
  hasAfter: boolean
  /** Uncompressed JSON bytes of the messages in this page, when known. */
  bytes?: number
}

export type ShareSession = {
  /** Only sent by the plugin. The service strips this before storing/serving. */
  id?: string
  agent?: string
  model?: ModelRef
  /** True while the agent is still producing this turn. */
  running?: boolean
  /** True while the TUI has a staged revert boundary. */
  reverted?: boolean
}

export type ShareSnapshot = {
  v: 1
  title: string
  createdAt: number
  source: {
    app: "opencode"
    version: string
  }
  session: ShareSession
  privacy?: SharePrivacy
  messages: ShareMessage[]
}

export type ShareStats = {
  /** Raw snapshot messages, including every assistant step. */
  messages: number
  /** User-visible conversation turns; consecutive assistant steps count once. */
  turns: number
  tools: number
  cost: number
  tokens: { input: number; output: number; reasoning: number }
}

export type ShareLimits = {
  viewMaxBytes: number
}

/** Initial public payload returned by the service. */
export type PublicShareResponse = ShareSnapshot & {
  id: string
  updatedAt: number
  expiresAt: number
  page: SharePageInfo
  index: ShareIndexItem[]
  limits?: ShareLimits
  stats: ShareStats
}

/** One page from `/api/public/shares/:id/messages`. */
export type PublicMessagePage = {
  messages: ShareMessage[]
  page: SharePageInfo
  privacy?: SharePrivacy
  limits?: ShareLimits
  updatedAt: number
}

/** WebSocket live update (metadata only). */
export type PublicLiveUpdate = {
  id: string
  updatedAt: number
  expiresAt: number
  title: string
  createdAt: number
  source: ShareSnapshot["source"]
  session: ShareSession
  stats: ShareStats
  index: ShareIndexItem[]
  privacy?: SharePrivacy
  total: number
}
