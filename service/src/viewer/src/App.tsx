import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type {
  ShareAssistantMessage,
  ShareAssistantPart,
  ShareIndexItem,
  ShareMessage,
  SharePageInfo,
  ShareSnapshot,
  ShareToolPart,
} from "../../../../shared/types"
import { highlightCode, languageFromFile, renderMarkdown } from "./markdown"
import { applyTheme, loadThemeMode, storeThemeMode, type ThemeMode } from "./theme"

export type PublicShare = ShareSnapshot & {
  id: string
  updatedAt: number
  expiresAt: number
  page: SharePageInfo
  index: ShareIndexItem[]
  stats: {
    messages: number
    tools: number
    cost: number
    tokens: { input: number; output: number; reasoning: number }
  }
}

type PageData = {
  messages: ShareMessage[]
  page: SharePageInfo
  privacy?: PublicShare["privacy"]
  updatedAt: number
}

type LiveUpdate = {
  id: string
  updatedAt: number
  expiresAt: number
  title: string
  createdAt: number
  source: PublicShare["source"]
  session: PublicShare["session"]
  stats: PublicShare["stats"]
  index: ShareIndexItem[]
  privacy?: PublicShare["privacy"]
  total: number
}

type SearchResult = ShareIndexItem

type Status = "loading" | "live" | "reconnecting" | "revoked" | "error"

const reconnectDelays = [1000, 2000, 5000, 10000, 30000]

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16.5h.01" />
    </svg>
  )
}

const themeOptions = [
  { mode: "light" as const, label: "Light", icon: SunIcon },
  { mode: "dark" as const, label: "Dark", icon: MoonIcon },
  { mode: "system" as const, label: "System", icon: MonitorIcon },
]

function SparklesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="M5 16l.7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7L5 16Z" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

type DirectoryItem = ShareIndexItem & {
  label: string
}

function previewText(text: string, limit = 160) {
  const value = text.replace(/\s+/g, " ").trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function highlightPreview(text: string, query: string) {
  const needle = query.trim()
  if (!needle) return escapeHtml(text)
  const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (at < 0) return escapeHtml(text)
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(
    text.slice(at, at + needle.length),
  )}</mark>${escapeHtml(text.slice(at + needle.length))}`
}

const disclosureState = new Map<string, boolean>()

function useDisclosure(key: string, initial = false) {
  const [open, setOpen] = createSignal(disclosureState.get(key) ?? initial)

  const set = (next: boolean) => {
    disclosureState.set(key, next)
    setOpen(next)
  }

  const toggle = () => set(!open())

  const onToggle = (event: Event) => {
    const next = (event.currentTarget as HTMLDetailsElement).open
    disclosureState.set(key, next)
    setOpen(next)
  }

  return { open, set, toggle, onToggle }
}

type AssistantEntry = {
  message: ShareAssistantMessage
  index: number
}

type AssistantActivityPart = {
  messageIndex: number
  partIndex: number
  part: Exclude<ShareAssistantPart, { type: "text" }>
}

type AssistantBlock =
  | { kind: "text"; id: string; text: string }
  | {
      kind: "activity"
      key: string
      parts: AssistantActivityPart[]
      reasoning: number
      tools: number
      durationMs: number
    }

type TurnItem =
  | { kind: "assistant"; key: string; index: number; messages: AssistantEntry[] }
  | { kind: "message"; key: string; index: number; message: ShareMessage }

function buildDisplayTurns(messages: { message: ShareMessage; index: number }[]): TurnItem[] {
  const items: TurnItem[] = []
  let group: { start: number; messages: AssistantEntry[] } | undefined

  const flush = () => {
    if (!group) return
    items.push({
      kind: "assistant",
      key: `turn-${group.start}`,
      index: group.start,
      messages: group.messages,
    })
    group = undefined
  }

  for (const entry of messages) {
    if (entry.message.role === "assistant") {
      if (!group) group = { start: entry.index, messages: [] }
      group.messages.push({ message: entry.message, index: entry.index })
      continue
    }
    flush()
    items.push({
      kind: "message",
      key: `message-${entry.index}`,
      index: entry.index,
      message: entry.message,
    })
  }
  flush()
  return items
}

function buildAssistantBlocks(entries: AssistantEntry[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = []
  let activity: AssistantActivityPart[] = []

  const flush = () => {
    if (!activity.length) return
    const reasoning = activity.filter((entry) => entry.part.type === "reasoning").length
    const tools = activity.filter((entry) => entry.part.type === "tool").length
    const durationMs = activity.reduce((total, entry) => total + (entry.part.durationMs ?? 0), 0)
    blocks.push({
      kind: "activity",
      key: `activity-${activity[0].messageIndex}-${activity[0].partIndex}`,
      parts: activity,
      reasoning,
      tools,
      durationMs,
    })
    activity = []
  }

  for (const entry of entries) {
    entry.message.content.forEach((part, partIndex) => {
      if (part.type === "tool" && part.name === "todoread") return
      if (part.type === "text") {
        if (!part.text.trim()) return
        flush()
        blocks.push({ kind: "text", id: `p-${entry.index}-${partIndex}`, text: part.text })
        return
      }
      activity.push({ messageIndex: entry.index, partIndex, part })
    })
  }
  flush()
  return blocks
}

function turnMeta(entries: AssistantEntry[]) {
  const messages = entries.map((entry) => entry.message)
  const latest = [...messages].reverse()
  const tokens = messages.reduce(
    (total, message) => {
      if (!message.tokens) return total
      total.input += message.tokens.input
      total.output += message.tokens.output
      total.reasoning += message.tokens.reasoning
      return total
    },
    { input: 0, output: 0, reasoning: 0 },
  )
  return {
    agent: latest.find((message) => message.agent)?.agent,
    model: latest.find((message) => message.model)?.model,
    completed: latest.find((message) => message.completed !== undefined)?.completed,
    cost: messages.reduce((total, message) => total + (message.cost ?? 0), 0),
    tokens,
  }
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatCost(value: number) {
  if (!value) return "$0"
  return `$${value.toFixed(value < 0.01 ? 5 : 4)}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function modelLabels(share: PublicShare) {
  const models = new Set<string>()
  if (share.session.model) models.add(`${share.session.model.providerID}/${share.session.model.id}`)
  for (const message of share.messages) {
    if (message.role === "assistant" && message.model) {
      models.add(`${message.model.providerID}/${message.model.id}`)
    }
  }
  return [...models]
}

export function App() {
  const id = location.pathname.split("/").filter(Boolean).pop() ?? ""
  const [share, setShare] = createSignal<PublicShare | null>(null)
  const [status, setStatus] = createSignal<Status>("loading")
  const [error, setError] = createSignal("")
  const [showBottom, setShowBottom] = createSignal(false)
  const [showTop, setShowTop] = createSignal(false)
  const [clock, setClock] = createSignal(Date.now())
  const [scrollTick, setScrollTick] = createSignal(0)
  const [activeDirectoryId, setActiveDirectoryId] = createSignal("")
  const [directoryOpen, setDirectoryOpen] = createSignal(false)
  const [themeMode, setThemeMode] = createSignal<ThemeMode>(loadThemeMode())
  const [hoveredDirectory, setHoveredDirectory] = createSignal<{
    item: DirectoryItem
    top: number
  } | null>(null)
  const [loadingPage, setLoadingPage] = createSignal(false)
  const [newMessages, setNewMessages] = createSignal(false)
  const [pendingTarget, setPendingTarget] = createSignal("")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchResults, setSearchResults] = createSignal<SearchResult[]>([])
  const [searching, setSearching] = createSignal(false)
  let searchTimer: number | undefined
  let searchController: AbortController | undefined
  let pageRequest = 0
  let lastScrollY = 0

  let socket: WebSocket | undefined
  let reconnectTimer: number | undefined
  let attempt = 0
  let closed = false
  let generation = 0
  let refreshing = false
  let pendingFresh = false
  let activeFrame: number | undefined
  let directoryRail: HTMLElement | undefined
  let directoryButton: HTMLButtonElement | undefined
  let directoryPanel: HTMLElement | undefined

  createEffect(() => {
    if (!directoryOpen()) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (directoryPanel?.contains(target) || directoryButton?.contains(target)) return
      setDirectoryOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDirectoryOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  createEffect(() => {
    const active = activeDirectoryId()
    if (!active) return
    queueMicrotask(() => {
      const rail = directoryRail
      const item = rail?.querySelector<HTMLElement>("[data-active]")
      if (!rail || !item) return
      const railRect = rail.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      if (itemRect.top < railRect.top) rail.scrollTop -= railRect.top - itemRect.top + 8
      else if (itemRect.bottom > railRect.bottom) rail.scrollTop += itemRect.bottom - railRect.bottom + 8
    })
  })

  const applySnapshot = (data: PublicShare) => {
    const current = share()
    if (!current) {
      setShare(data)
      return
    }
    if (data.updatedAt <= current.updatedAt) return

    if (current.page.start === 0 && current.page.end <= data.page.end) {
      setShare(data)
      return
    }

    // Keep the window the reader is on. Only refresh the global metadata,
    // stats and directory index.
    setShare({
      ...current,
      ...data,
      messages: current.messages,
      page: current.page,
    })
    if (data.page.total > current.page.total) setNewMessages(true)
  }

  const fetchPage = async (
    cursor: { start?: number; before?: number },
    signal?: AbortSignal,
  ): Promise<PageData> => {
    const query = new URLSearchParams()
    if (cursor.start !== undefined) query.set("start", String(cursor.start))
    if (cursor.before !== undefined) query.set("before", String(cursor.before))
    const response = await fetch(
      `/api/public/shares/${encodeURIComponent(id)}/messages?${query.toString()}`,
      { cache: "no-store", signal },
    )
    if (response.status === 410) {
      closed = true
      generation++
      setShare(null)
      setStatus("revoked")
      socket?.close()
      throw new Error("revoked")
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as PageData
  }

  const mergePage = (data: PageData, mode: "replace" | "append" | "prepend") => {
    const current = share()
    if (!current) return
    if (mode === "replace") {
      setShare({
        ...current,
        messages: data.messages,
        page: data.page,
        privacy: data.privacy ?? current.privacy,
        updatedAt: Math.max(current.updatedAt, data.updatedAt),
      })
      return
    }
    if (mode === "append") {
      setShare({
        ...current,
        messages: [...current.messages, ...data.messages],
        page: {
          ...data.page,
          start: current.page.start,
          hasBefore: current.page.hasBefore,
        },
        updatedAt: Math.max(current.updatedAt, data.updatedAt),
      })
      return
    }
    setShare({
      ...current,
      messages: [...data.messages, ...current.messages],
      page: {
        ...current.page,
        start: data.page.start,
        total: data.page.total,
        hasBefore: data.page.hasBefore,
      },
      updatedAt: Math.max(current.updatedAt, data.updatedAt),
    })
  }

  const loadNextPage = async (force = false) => {
    const current = share()
    if (!current || loadingPage() || (!force && !current.page.hasAfter)) return
    const follow =
      force &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ start: current.page.end })
      if (request !== pageRequest) return
      mergePage(data, data.page.start === current.page.end ? "append" : "replace")
      setNewMessages(false)
      if (follow) {
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
          })
        })
      }
    } catch {
      // The scroll sentinel will retry on the next scroll.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const loadPreviousPage = async () => {
    const current = share()
    if (!current || loadingPage() || !current.page.hasBefore) return
    const request = ++pageRequest
    const height = document.documentElement.scrollHeight
    const top = window.scrollY
    setLoadingPage(true)
    try {
      const data = await fetchPage({ before: current.page.start })
      if (request !== pageRequest) return
      mergePage(data, data.page.end === current.page.start ? "prepend" : "replace")
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          const delta = document.documentElement.scrollHeight - height
          if (delta > 0) window.scrollTo({ top: top + delta, behavior: "auto" })
        })
      })
    } catch {
      // Keep the current window if the previous page fails.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const loadTail = async () => {
    const current = share()
    if (!current || loadingPage()) return
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ before: current.page.total })
      if (request !== pageRequest) return
      mergePage(data, "replace")
      setNewMessages(false)
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
        })
      })
    } catch {
      // Keep the current window.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const goToFirstPage = async () => {
    const current = share()
    if (!current || loadingPage()) return
    if (!current.page.hasBefore) {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ start: 0 })
      if (request !== pageRequest) return
      mergePage(data, "replace")
      queueMicrotask(() => {
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
      })
    } catch {
      // Keep the current window.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const goToBottom = () => {
    const current = share()
    if (current?.page.hasAfter) {
      void loadTail()
      return
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
  }

  const jumpToTarget = async (target: string, messageIndex: number) => {
    setHoveredDirectory(null)
    const existing = document.getElementById(target)
    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    const current = share()
    if (!current || loadingPage()) return
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ start: messageIndex })
      if (request !== pageRequest) return
      mergePage(data, "replace")
      setPendingTarget(target)
    } catch {
      // Leave the current page in place.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const applyLiveUpdate = (data: LiveUpdate) => {
    const current = share()
    if (!current) {
      void refresh(true)
      return
    }
    if (data.updatedAt <= current.updatedAt) return

    if (data.total < current.page.total) {
      // Compaction or a rewritten active context invalidates message indices.
      setShare(null)
      void refresh(true)
      return
    }

    setShare({
      ...current,
      id: data.id,
      updatedAt: data.updatedAt,
      expiresAt: data.expiresAt,
      title: data.title,
      createdAt: data.createdAt,
      source: data.source,
      session: data.session,
      stats: data.stats,
      index: data.index,
      privacy: data.privacy,
      page: {
        ...current.page,
        total: data.total,
        hasAfter: current.page.end < data.total ? true : current.page.hasAfter,
      },
    })

    if (data.total > current.page.total) {
      setNewMessages(true)
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
      if (atBottom && !current.page.hasAfter) void loadNextPage(true)
    }
  }

  const refresh = async (fresh = false) => {
    if (refreshing) {
      if (fresh) pendingFresh = true
      return
    }
    refreshing = true
    try {
      const suffix = fresh ? `?fresh=${Date.now()}` : ""
      const response = await fetch(`/api/public/shares/${encodeURIComponent(id)}${suffix}`, {
        cache: fresh ? "no-store" : "default",
      })
      if (response.status === 410) {
        closed = true
        generation++
        setShare(null)
        setStatus("revoked")
        socket?.close()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as PublicShare
      if (closed) return
      applySnapshot(data)
      setClock(Date.now())
      setStatus((current) => (current === "revoked" ? current : "live"))
    } catch (cause) {
      // If the socket already delivered a snapshot, a failed fallback fetch
      // should not replace the page with an error screen.
      if (closed || share()) return
      setStatus("error")
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      refreshing = false
      if (pendingFresh) {
        pendingFresh = false
        void refresh(true)
      }
    }
  }

  const connect = () => {
    if (closed) return
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }

    const currentGeneration = ++generation
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(
      `${protocol}//${location.host}/api/public/shares/${encodeURIComponent(id)}/stream`,
    )
    socket = ws

    ws.onopen = () => {
      if (currentGeneration !== generation) return
      attempt = 0
      setStatus("live")
      const current = share()
      if (!current || Date.now() - current.updatedAt > 10_000) void refresh(true)
    }

    ws.onmessage = (event) => {
      if (currentGeneration !== generation) return
      if (event.data === "pong") return
      if (event.data === "ping") {
        ws.send("pong")
        return
      }
      try {
        const message = JSON.parse(String(event.data))
        if (message.type === "update") {
          applyLiveUpdate(message.data as LiveUpdate)
          setClock(Date.now())
          setStatus("live")
        }
        if (message.type === "revoked") {
          closed = true
          generation++
          setShare(null)
          setStatus("revoked")
          ws.close()
        }
      } catch {
        // Ignore malformed frames.
      }
    }

    ws.onclose = (event) => {
      if (currentGeneration !== generation) return
      if (closed) return
      if (event.code === 4100 || event.code === 4410) {
        closed = true
        generation++
        setShare(null)
        setStatus("revoked")
        return
      }
      setStatus("reconnecting")
      const delay = reconnectDelays[Math.min(attempt++, reconnectDelays.length - 1)]
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        connect()
      }, delay)
    }

    ws.onerror = () => {
      // onclose handles the retry.
    }
  }

  const disconnect = () => {
    closed = true
    generation++
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    socket?.close()
    socket = undefined
  }

  onMount(() => {
    applyTheme(themeMode())
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (themeMode() === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    onCleanup(() => media.removeEventListener("change", onChange))
  })

  onMount(() => {
    if (!id) {
      setStatus("error")
      setError("Missing share id")
      return
    }

    // Start the WebSocket immediately and fetch the JSON snapshot in parallel.
    // The API response is only a fallback/initial fill; never let an older
    // response overwrite a newer WebSocket snapshot.
    connect()
    void refresh()

    const onScroll = () => {
      const current = share()
      const scrollingUp = window.scrollY < lastScrollY - 2
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700
      const atTop = window.scrollY < 260
      setShowTop(window.scrollY > 400 || !!current?.page.hasBefore)
      setShowBottom(
        !!current?.page.hasAfter ||
          (window.scrollY > 500 &&
            window.innerHeight + window.scrollY < document.body.scrollHeight - 120),
      )
      if (current && atBottom && current.page.hasAfter) void loadNextPage()
      if (current && atTop && current.page.hasBefore && scrollingUp) void loadPreviousPage()
      lastScrollY = window.scrollY
      if (activeFrame === undefined) {
        activeFrame = window.requestAnimationFrame(() => {
          activeFrame = undefined
          setScrollTick((value) => value + 1)
        })
      }
    }
    const onCopy = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest("[data-copy]") as HTMLElement | null
      if (!target) return
      const scope = target.closest("[data-code-scope]")
      const text = scope?.querySelector("code")?.textContent ?? ""
      if (!text) return
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          target.dataset.copied = "true"
          window.setTimeout(() => delete target.dataset.copied, 1500)
        })
        .catch(() => {})
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      if (status() === "revoked") {
        void refresh(true)
        return
      }
      closed = false
      setStatus("reconnecting")
      socket?.close()
      connect()
      void refresh(true)
    }

    const tick = window.setInterval(() => setClock(Date.now()), 5000)
    const poll = window.setInterval(() => {
      if (closed || document.visibilityState !== "visible") return
      const current = share()
      if (!current) return
      if (status() === "reconnecting" || Date.now() - current.updatedAt > 20_000) {
        void refresh(true)
      }
    }, 15_000)

    window.addEventListener("scroll", onScroll, { passive: true })
    document.addEventListener("click", onCopy)
    window.addEventListener("pageshow", onPageShow)
    onCleanup(() => {
      disconnect()
      window.clearInterval(tick)
      window.clearInterval(poll)
      if (activeFrame !== undefined) window.cancelAnimationFrame(activeFrame)
      window.removeEventListener("scroll", onScroll)
      document.removeEventListener("click", onCopy)
      window.removeEventListener("pageshow", onPageShow)
    })
  })

  const chooseTheme = (mode: ThemeMode) => {
    setThemeMode(mode)
    storeThemeMode(mode)
    applyTheme(mode)
  }

  const stats = createMemo(() => {
    const current = share()
    return current?.stats ?? { messages: 0, tools: 0, cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } }
  })

  const models = createMemo(() => (share() ? modelLabels(share()!) : []))

  const detailsOmitted = createMemo(() => {
    const privacy = share()?.privacy
    if (!privacy) return false
    if (typeof privacy.detailsOmitted === "boolean") return privacy.detailsOmitted
    return !!privacy.truncated && !privacy.bodyTruncated
  })

  const bodyTruncated = createMemo(() => !!share()?.privacy?.bodyTruncated)

  const liveState = createMemo(() => {
    if (status() === "revoked") return "revoked"
    if (status() === "error") return "offline"
    const current = share()
    if (!current) return "loading"
    if (status() === "reconnecting") return "reconnecting"
    return clock() - current.updatedAt > 90_000 ? "stale" : "live"
  })

  const liveTitle = () => {
    const current = share()
    if (!current) return "Waiting for the first snapshot"
    return `Snapshot updated ${formatDuration(Math.max(0, clock() - current.updatedAt))} ago`
  }

  const indexedMessages = createMemo(() => {
    const current = share()
    if (!current) return []
    return current.messages.map((message, index) => ({
      message,
      index: current.page.start + index,
    }))
  })

  const displayTurns = createMemo(() => buildDisplayTurns(indexedMessages()))

  const lastTextId = createMemo(() => {
    const current = share()
    if (!current || current.page.hasAfter) return ""
    for (let index = current.messages.length - 1; index >= 0; index--) {
      const message = current.messages[index]
      if (message.role !== "assistant") continue
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
        const part = message.content[partIndex]
        if (part.type === "text" && part.text.trim()) {
          return `p-${current.page.start + index}-${partIndex}`
        }
      }
    }
    return ""
  })

  const directoryItems = createMemo<DirectoryItem[]>(() =>
    (share()?.index ?? []).map((item) => ({
      ...item,
      label: item.role === "user" ? "You" : "Agent",
    })),
  )

  createEffect(() => {
    scrollTick()
    const items = directoryItems()
    if (!items.length) {
      setActiveDirectoryId("")
      return
    }
    let active = ""
    for (const item of items) {
      const element = document.getElementById(item.id)
      if (!element) continue
      if (!active) active = item.id
      if (element.getBoundingClientRect().top <= 140) active = item.id
      else break
    }
    setActiveDirectoryId(active)
  })

  createEffect(() => {
    const target = pendingTarget()
    if (!target) return
    const current = share()
    if (!current) return
    void current.messages.length
    void current.page.end
    queueMicrotask(() => {
      const element = document.getElementById(target)
      if (!element) return
      element.scrollIntoView({ behavior: "smooth", block: "start" })
      setPendingTarget("")
    })
  })

  createEffect(() => {
    const current = share()
    if (!current || loadingPage() || !current.page.hasAfter) return
    void current.page.end
    queueMicrotask(() => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 400) {
        void loadNextPage()
      }
    })
  })

  const scrollToTarget = (item: DirectoryItem) => {
    setHoveredDirectory(null)
    void jumpToTarget(item.id, item.messageIndex)
  }

  const runSearch = async (query: string) => {
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    setSearching(true)
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(id)}/search?q=${encodeURIComponent(query)}`,
        { cache: "no-store", signal: controller.signal },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { results?: SearchResult[] }
      if (searchQuery().trim() === query) setSearchResults(data.results ?? [])
    } catch {
      if (!controller.signal.aborted) setSearchResults([])
    } finally {
      if (searchController === controller) setSearching(false)
    }
  }

  const onSearchInput = (value: string) => {
    setSearchQuery(value)
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer)
      searchTimer = undefined
    }
    searchController?.abort()
    const query = value.trim()
    if (!query || query.length > 200) {
      setSearchResults([])
      setSearching(false)
      return
    }
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined
      void runSearch(query)
    }, 200)
  }

  const goToSearchResult = (result: SearchResult) => {
    setDirectoryOpen(false)
    void jumpToTarget(result.id, result.messageIndex)
  }

  onCleanup(() => {
    if (searchTimer !== undefined) clearTimeout(searchTimer)
    searchController?.abort()
  })

  const currentThemeOption = () =>
    themeOptions.find((option) => option.mode === themeMode()) ?? themeOptions[2]
  const nextThemeOption = () => {
    const index = themeOptions.findIndex((option) => option.mode === themeMode())
    return themeOptions[(index + 1) % themeOptions.length]
  }
  const cycleTheme = () => chooseTheme(nextThemeOption().mode)

  return (
    <div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
      <div class="live-pill no-print" data-state={liveState()} title={liveTitle()}>
        <span class="live-dot" />
        <span>{liveState()}</span>
      </div>
      <header class="mb-8 border-b border-[var(--line)] pb-6">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
            <span>OpenCode session</span>
          </div>
          <button
            type="button"
            class="theme-toggle no-print grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            aria-label={`Theme: ${currentThemeOption().label}. Click to switch to ${nextThemeOption().label}.`}
            title={`Theme: ${currentThemeOption().label} (click for ${nextThemeOption().label})`}
            onClick={cycleTheme}
          >
            {currentThemeOption().icon()}
          </button>
        </div>

        <Show
          when={share()}
          fallback={
            <Show when={status() !== "revoked" && status() !== "error"}>
              <div class="h-10 w-2/3 animate-pulse rounded bg-[var(--page-soft)]" />
            </Show>
          }
        >
          {(current) => (
            <>
              <h1 class="mb-4 line-clamp-3 text-3xl font-medium leading-tight tracking-[-0.045em] sm:text-4xl">
                {current().title}
              </h1>
              <div class="session-meta">
                <div class="meta-grid meta-grid-primary">
                  <Show when={models().length > 0}>
                    <div class="meta-item meta-model">
                      <span class="meta-label">Model</span>
                      <span class="meta-value" title={models().join(" · ")}>
                        {models().join(" · ")}
                      </span>
                    </div>
                  </Show>
                  <Show when={current().session.agent}>
                    <div class="meta-item">
                      <span class="meta-label">Agent</span>
                      <span class="meta-value">{current().session.agent}</span>
                    </div>
                  </Show>
                  <div class="meta-item">
                    <span class="meta-label">Version</span>
                    <span class="meta-value">OpenCode {current().source.version}</span>
                  </div>
                </div>
                <div class="meta-chips">
                  <span class="meta-chip">
                    <span class="meta-chip-label">Messages</span>
                    {stats().messages}
                  </span>
                  <span class="meta-chip">
                    <span class="meta-chip-label">Tools</span>
                    {stats().tools}
                  </span>
                  <span class="meta-chip">
                    <span class="meta-chip-label">Tokens</span>
                    {formatNumber(stats().tokens.input + stats().tokens.output)}
                  </span>
                  <span class="meta-chip">
                    <span class="meta-chip-label">Cost</span>
                    {formatCost(stats().cost)}
                  </span>
                  <span class="meta-chip">
                    <span class="meta-chip-label">Created</span>
                    {formatDate(current().createdAt)}
                  </span>
                  <span class="meta-chip">
                    <span class="meta-chip-label">Expires</span>
                    {formatDate(current().expiresAt)}
                  </span>
                </div>
              </div>
            </>
          )}
        </Show>
      </header>

      <Show when={status() === "revoked"}>
        <div class="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--page-soft)] px-6 py-10 text-center sm:px-10 sm:py-12">
          <div class="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)]">
            <LockIcon />
          </div>
          <h2 class="mb-2 text-lg font-medium">This share is no longer available</h2>
          <p class="text-sm leading-6 text-[var(--ink-muted)]">It may have been unshared or expired.</p>
        </div>
      </Show>

      <Show when={status() === "error"}>
        <div class="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--page-soft)] px-6 py-10 text-center sm:px-10 sm:py-12">
          <div class="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)]">
            <AlertIcon />
          </div>
          <h2 class="mb-2 text-lg font-medium">Unable to load this share</h2>
          <p class="text-sm leading-6 text-[var(--ink-muted)]">{error() || "Unknown error"}</p>
        </div>
      </Show>

      <Show when={!share() && status() !== "revoked" && status() !== "error"}>
        <div class="space-y-4">
          <For each={[1, 2, 3]}>{() => <div class="h-24 animate-pulse rounded-xl bg-[var(--page-soft)]" />}</For>
        </div>
      </Show>

      <Show when={share()}>
        {(current) => (
          <main class="timeline">
            <Show when={current().page.hasBefore}>
              <div class="load-edge load-before">
                <span>Earlier messages are not loaded</span>
                <button
                  type="button"
                  disabled={loadingPage()}
                  onClick={() => void loadPreviousPage()}
                >
                  {loadingPage() ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            </Show>
            <For each={displayTurns()}>
              {(turn) => {
                if (turn.kind === "assistant") {
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
                          messages={turn.messages}
                          shareId={current().id}
                          lastTextId={lastTextId()}
                        />
                      </div>
                    </div>
                  )
                }
                return (
                  <div class="timeline-item" id={`m-${turn.index}`}>
                    <div class="timeline-rail">
                      <span class="timeline-icon" data-role={turn.message.role} aria-hidden="true">
                        {turn.message.role === "user"
                          ? "U"
                          : turn.message.role === "shell"
                            ? "$"
                            : "·"}
                      </span>
                      <span class="timeline-line" />
                    </div>
                    <div class="timeline-content">
                      <MessageView
                        message={turn.message}
                        index={turn.index}
                        lastTextId={lastTextId()}
                        shareId={current().id}
                      />
                    </div>
                  </div>
                )
              }}
            </For>
            <Show when={current().page.hasAfter}>
              <div class="load-edge load-after">
                <button
                  type="button"
                  disabled={loadingPage()}
                  onClick={() => void loadNextPage()}
                >
                  {loadingPage() ? "Loading…" : "Load more messages"}
                </button>
              </div>
            </Show>
          </main>
        )}
      </Show>

      <Show when={share() && status() !== "revoked" && status() !== "error"}>
        <footer class="share-footer">
          <div class="footer-grid">
            <div class="meta-item">
              <span class="meta-label">Snapshot</span>
              <span class="meta-value">Read-only</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Updated</span>
              <span class="meta-value">{formatDate(share()!.updatedAt)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Expires</span>
              <span class="meta-value">{formatDate(share()!.expiresAt)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Visibility</span>
              <span class="meta-value">Anyone with link</span>
            </div>
          </div>
          <div class="footer-notes">
            <p>
              This page uses OpenCode&apos;s active context. Earlier history is represented by the
              compaction summary.
            </p>
            <Show when={bodyTruncated()}>
              <span class="footer-warning">Some message text could not be included</span>
            </Show>
            <Show when={detailsOmitted()}>
              <span class="footer-note">Tool and thinking details load on demand</span>
            </Show>
            <p>Shared with OpenCode. Anyone with the link can view this snapshot.</p>
          </div>
        </footer>
      </Show>

      <Show when={directoryItems().length > 1}>
        <nav ref={directoryRail} class="directory-rail no-print" aria-label="Message directory">
          <For each={directoryItems()}>
            {(item) => (
              <button
                type="button"
                class="directory-item"
                data-role={item.role}
                data-active={activeDirectoryId() === item.id ? true : undefined}
                aria-label={`Jump to ${item.label}: ${item.preview}`}
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setHoveredDirectory({ item, top: rect.top + rect.height / 2 })
                }}
                onMouseLeave={() => setHoveredDirectory(null)}
                onClick={() => scrollToTarget(item)}
              >
                <span class="directory-tick" />
              </button>
            )}
          </For>
        </nav>
      </Show>

      <Show when={stats().messages > 30}>
        <button
          ref={directoryButton}
          type="button"
          class="directory-button no-print"
          aria-expanded={directoryOpen()}
          onClick={() => setDirectoryOpen((value) => !value)}
        >
          Contents
        </button>
        <Show when={directoryOpen()}>
          <aside ref={directoryPanel} class="directory-panel no-print" aria-label="Message directory">
            <div class="directory-panel-head">
              <span>Contents</span>
              <button type="button" aria-label="Close contents" onClick={() => setDirectoryOpen(false)}>
                ×
              </button>
            </div>
            <div class="directory-search">
              <input
                type="search"
                placeholder="Search user and agent messages"
                aria-label="Search user and agent messages"
                value={searchQuery()}
                onInput={(event) => onSearchInput(event.currentTarget.value)}
              />
              <Show when={searching()}>
                <span class="directory-search-state">…</span>
              </Show>
            </div>
            <div class="directory-panel-list">
              <Show
                when={searchQuery().trim()}
                fallback={
                  <For each={directoryItems()}>
                    {(item) => (
                      <button
                        type="button"
                        class="directory-entry"
                        data-active={activeDirectoryId() === item.id ? true : undefined}
                        onClick={() => {
                          scrollToTarget(item)
                          setDirectoryOpen(false)
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
                  when={searchResults().length > 0}
                  fallback={
                    <div class="directory-empty">
                      {searching() ? "Searching…" : "No matches"}
                    </div>
                  }
                >
                  <For each={searchResults()}>
                    {(result) => (
                      <button
                        type="button"
                        class="directory-entry"
                        onClick={() => goToSearchResult(result)}
                      >
                        <span class="directory-entry-head">
                          <span class="directory-entry-role">
                            {result.role === "user" ? "You" : "Agent"}
                          </span>
                          <span class="directory-entry-time">{formatDate(result.time)}</span>
                        </span>
                        <span
                          class="directory-entry-preview"
                          innerHTML={highlightPreview(result.preview, searchQuery())}
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

      <Show when={hoveredDirectory()}>
        {(hover) => (
          <div class="directory-preview no-print" style={{ top: `${hover().top}px` }}>
            <div class="directory-preview-role">{hover().item.label}</div>
            <p class="directory-preview-text">{hover().item.preview}</p>
            <div class="directory-preview-time">{formatDate(hover().item.time)}</div>
          </div>
        )}
      </Show>

      <Show when={newMessages()}>
        <button
          type="button"
          class="new-messages no-print"
          onClick={() => void loadTail()}
        >
          New messages
        </button>
      </Show>

      <div class="scroll-controls no-print">
        <button
          type="button"
          class={`scroll-control ${
            showTop() || share()?.page.hasBefore ? "" : "pointer-events-none opacity-0"
          }`}
          aria-label="Back to top"
          title="Back to top"
          onClick={() => void goToFirstPage()}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          class={`scroll-control ${
            showBottom() || share()?.page.hasAfter ? "" : "pointer-events-none opacity-0"
          }`}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          onClick={goToBottom}
        >
          <ArrowDownIcon />
        </button>
      </div>
    </div>
  )
}

function StatusBadge(props: { status: Status }) {
  const label = () => {
    switch (props.status) {
      case "live":
        return "live"
      case "reconnecting":
        return "reconnecting"
      case "revoked":
        return "revoked"
      case "error":
        return "error"
      default:
        return "loading"
    }
  }
  const color = () => {
    if (props.status === "live") return "bg-emerald-500"
    if (props.status === "reconnecting") return "bg-amber-500"
    if (props.status === "error" || props.status === "revoked") return "bg-red-500"
    return "bg-neutral-400"
  }
  return (
    <span class="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
      <span class={`h-1.5 w-1.5 rounded-full ${color()}`} />
      {label()}
    </span>
  )
}

function MessageView(props: {
  message: ShareMessage
  index: number
  lastTextId: string
  shareId: string
}) {
  if (props.message.role === "user") {
    return (
      <div class="bubble-user">
        <div class="prose-share" innerHTML={renderMarkdown(props.message.text)} />
        <Show when={props.message.files?.length}>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <For each={props.message.files}>
              {(file) => (
                <span class="rounded-md border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)]">
                  {file.name || "attachment"} · {file.mime}
                </span>
              )}
            </For>
          </div>
        </Show>
        <div class="mt-2 text-[11px] text-[var(--ink-muted)]">{formatDate(props.message.time)}</div>
      </div>
    )
  }

  if (props.message.role === "assistant") return null

  if (props.message.role === "shell") {
    return (
      <div class="terminal">
        <div class="terminal-head">shell · {props.message.status}</div>
        <pre>
          <span class="text-emerald-400">$</span> {props.message.command}
          {props.message.output ? `\n${props.message.output}` : ""}
        </pre>
        <Show when={props.message.exit !== undefined}>
          <div class="border-t border-[#21262d] px-3 py-1.5 text-[11px] text-[#9ca3af]">exit {String(props.message.exit)}</div>
        </Show>
      </div>
    )
  }

  if (props.message.role === "notice" && props.message.kind === "compaction") {
    return (
      <CompactionNotice
        text={props.message.text}
        shareId={props.shareId}
        time={props.message.time}
      />
    )
  }

  return (
    <div class="flex items-center gap-3 py-2 text-xs text-[var(--ink-muted)]">
      <span class="h-px flex-1 bg-[var(--line)]" />
      <span>{props.message.kind}</span>
      <span class="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}

function CompactionNotice(props: { text: string; shareId: string; time: number }) {
  const disclosure = useDisclosure(`compaction:${props.shareId}:${props.time}`)

  return (
    <details
      class="compaction"
      open={disclosure.open()}
      onToggle={disclosure.onToggle}
    >
      <summary>
        <span class="compaction-line" />
        <span class="compaction-label">Context compacted</span>
        <span class="compaction-toggle">
          <span class="compaction-closed">Show summary</span>
          <span class="compaction-open">Hide summary</span>
        </span>
        <span class="compaction-line" />
      </summary>
      <div class="compaction-body prose-share">
        <Show when={props.text.trim()} fallback={<p>No summary available.</p>}>
          <div innerHTML={renderMarkdown(props.text)} />
        </Show>
      </div>
    </details>
  )
}

function AssistantTurn(props: { messages: AssistantEntry[]; shareId: string; lastTextId: string }) {
  const blocks = createMemo(() => buildAssistantBlocks(props.messages))
  const meta = createMemo(() => turnMeta(props.messages))
  const hasText = () => blocks().some((block) => block.kind === "text")
  const hasTokens = () => {
    const tokens = meta().tokens
    return tokens.input + tokens.output + tokens.reasoning > 0
  }

  return (
    <div class="assistant-turn">
      <For each={blocks()}>
        {(block) =>
          block.kind === "text" ? (
            <TextPart
              id={block.id}
              text={block.text}
              expand={block.id === props.lastTextId}
              shareId={props.shareId}
            />
          ) : (
            <ActivityGroup block={block} shareId={props.shareId} />
          )
        }
      </For>

      <Show when={hasText()}>
        <div class="assistant-meta">
          <Show when={meta().agent}>
            <span>agent {meta().agent}</span>
          </Show>
          <Show when={meta().model}>
            <span>
              {meta().model!.providerID}/{meta().model!.id}
            </span>
          </Show>
          <Show when={meta().cost > 0}>
            <span>{formatCost(meta().cost)}</span>
          </Show>
          <Show when={hasTokens()}>
            <span>{formatNumber(meta().tokens.input + meta().tokens.output)} tokens</span>
          </Show>
          <Show when={meta().completed !== undefined}>
            <span>{formatDate(meta().completed!)}</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ActivityGroup(props: {
  block: Extract<AssistantBlock, { kind: "activity" }>
  shareId: string
}) {
  const disclosure = useDisclosure(`activity:${props.shareId}:${props.block.key}`)
  const label = () => {
    const labels: string[] = []
    if (props.block.reasoning) labels.push("Thinking")
    if (props.block.tools) {
      labels.push(`${props.block.tools} tool${props.block.tools === 1 ? "" : "s"}`)
    }
    return labels.join(" · ")
  }

  return (
    <details
      class="activity-group"
      open={disclosure.open()}
      onToggle={disclosure.onToggle}
    >
      <summary class="activity-summary">
        <span class="activity-label">
          <Show when={props.block.reasoning > 0}>
            <SparklesIcon />
          </Show>
          <Show when={props.block.tools > 0}>
            <TerminalIcon />
          </Show>
          <span>{label()}</span>
          <Show when={props.block.durationMs > 0}>
            <span class="activity-duration">{formatDuration(props.block.durationMs)}</span>
          </Show>
        </span>
        <span class="activity-toggle">
          <span class="activity-closed">Show details</span>
          <span class="activity-open">Hide details</span>
        </span>
      </summary>
      <div class="activity-body">
        <For each={props.block.parts}>
          {(entry) =>
            entry.part.type === "reasoning" ? (
              <ReasoningPart
                text={entry.part.text}
                durationMs={entry.part.durationMs}
                shareId={props.shareId}
                messageIndex={entry.messageIndex}
                partIndex={entry.partIndex}
              />
            ) : (
              <ToolCard
                part={entry.part}
                shareId={props.shareId}
                messageIndex={entry.messageIndex}
                partIndex={entry.partIndex}
              />
            )
          }
        </For>
      </div>
    </details>
  )
}

function TextPart(props: { id: string; text: string; expand?: boolean; shareId: string }) {
  const key = `text:${props.shareId}:${props.id}`
  const disclosure = useDisclosure(key, props.expand === true)
  const expanded = disclosure.open
  const [overflow, setOverflow] = createSignal(false)
  let ref: HTMLDivElement | undefined

  const measure = () => {
    if (!ref || expanded()) return
    setOverflow(ref.scrollHeight > ref.clientHeight + 2)
  }

  onMount(measure)
  createEffect(() => {
    void props.text
    if (props.expand && !disclosureState.has(key)) disclosure.set(true)
    queueMicrotask(measure)
  })

  const toggle = () => {
    disclosure.toggle()
    queueMicrotask(measure)
  }

  return (
    <div class="assistant-text" id={props.id} data-expanded={expanded() ? true : undefined}>
      <div ref={ref} class="prose-share" innerHTML={renderMarkdown(props.text)} />
      <Show when={overflow() || expanded()}>
        <button
          type="button"
          class="text-toggle text-more"
          data-expanded={expanded() ? true : undefined}
          onClick={toggle}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      </Show>
    </div>
  )
}

function usePartDetail(props: { shareId: string; messageIndex: number; partIndex: number }) {
  const [detail, setDetail] = createSignal<ShareAssistantPart | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  let requested = false

  const load = () => {
    if (requested) return
    requested = true
    setFailed(false)
    setLoading(true)
    void fetch(
      `/api/public/shares/${encodeURIComponent(props.shareId)}/parts/${props.messageIndex}/${props.partIndex}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { part?: ShareAssistantPart } | null) => {
        if (data?.part) {
          setDetail(data.part)
        } else {
          requested = false
          setFailed(true)
        }
      })
      .catch(() => {
        requested = false
        setFailed(true)
      })
      .finally(() => setLoading(false))
  }

  return { detail, loading, failed, load }
}

function ReasoningPart(props: {
  text: string
  durationMs?: number
  shareId: string
  messageIndex: number
  partIndex: number
}) {
  const detail = usePartDetail(props)
  const disclosure = useDisclosure(
    `reasoning:${props.shareId}:${props.messageIndex}:${props.partIndex}`,
  )
  const text = () => {
    const value = detail.detail()
    return value?.type === "reasoning" ? value.text : props.text
  }
  const durationMs = () => {
    const value = detail.detail()
    return value?.type === "reasoning" ? value.durationMs : props.durationMs
  }

  createEffect(() => {
    if (disclosure.open()) detail.load()
  })

  return (
    <details
      class="thinking"
      open={disclosure.open()}
      onToggle={(event) => {
        disclosure.onToggle(event)
        if ((event.currentTarget as HTMLDetailsElement).open) detail.load()
      }}
    >
      <summary>
        <span class="thinking-label">
          <SparklesIcon />
          <span>Thinking</span>
          <Show when={durationMs() !== undefined && durationMs()! >= 100}>
            <span class="thinking-duration">{formatDuration(durationMs()!)}</span>
          </Show>
        </span>
        <span class="thinking-toggle">
          <span class="thinking-closed">Show details</span>
          <span class="thinking-open">Hide details</span>
        </span>
      </summary>
      <div class="thinking-body prose-share" innerHTML={renderMarkdown(text())} />
      <Show when={detail.loading()}>
        <div class="detail-loading">Loading details…</div>
      </Show>
      <Show when={detail.failed() && !text()}>
        <div class="detail-loading">
          Details unavailable.
          <button type="button" class="text-toggle" onClick={() => detail.load()}>
            Retry
          </button>
        </div>
      </Show>
    </details>
  )
}

function ToolCard(props: {
  part: ShareToolPart
  shareId: string
  messageIndex: number
  partIndex: number
}) {
  const detail = usePartDetail(props)
  const disclosure = useDisclosure(
    `tool:${props.shareId}:${props.messageIndex}:${props.partIndex}`,
  )
  const current = () => {
    const value = detail.detail()
    return value?.type === "tool" ? value : props.part
  }
  const input = () => (current().input && typeof current().input === "object" ? current().input : {}) as Record<string, any>
  const kind = () => current().name
  const output = () => current().output ?? ""
  const durationLabel = () => {
    const value = current().durationMs
    return value !== undefined && value >= 1000 ? formatDuration(value) : ""
  }
  const hint = () => {
    const value = input()
    switch (current().name) {
      case "bash":
        return String(value.command ?? value.cmd ?? "")
      case "read":
      case "write":
      case "edit":
        return String(value.filePath ?? value.path ?? "")
      case "grep":
      case "glob":
        return String(value.pattern ?? value.query ?? "")
      case "list":
        return String(value.path ?? "")
      case "webfetch":
        return String(value.url ?? "")
      case "task":
        return String(value.description ?? "")
      default:
        return ""
    }
  }

  createEffect(() => {
    if (disclosure.open()) detail.load()
  })

  return (
    <details
      class="tool-card"
      data-tool={current().name}
      open={disclosure.open()}
      onToggle={(event) => {
        disclosure.onToggle(event)
        if ((event.currentTarget as HTMLDetailsElement).open) detail.load()
      }}
    >
      <summary>
        <span class={`h-1.5 w-1.5 flex-none rounded-full ${current().status === "completed" ? "bg-emerald-500" : "bg-red-500"}`} />
        <span class="tool-name">{current().name}</span>
        <Show when={hint()}>
          <span class="tool-hint">{previewText(hint(), 90)}</span>
        </Show>
        <span class="tool-meta">
          <Show when={current().status === "error"}>
            <span class="tool-status">error</span>
          </Show>
          <Show when={durationLabel()}>
            <span class="tool-duration">{durationLabel()}</span>
          </Show>
          <span class="tool-chevron" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>
      <div class="tool-body space-y-3">
        <Show when={detail.loading()}>
          <div class="detail-loading">Loading details…</div>
        </Show>
        <Show when={detail.failed()}>
          <div class="detail-loading">
            Details unavailable.
            <button type="button" class="text-toggle" onClick={() => detail.load()}>
              Retry
            </button>
          </div>
        </Show>
        <Show when={current().error}>
          <div class="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{current().error}</div>
        </Show>

        <Show when={kind() === "edit" && input().oldString !== undefined && input().newString !== undefined}>
          <DiffView
            file={String(input().filePath ?? input().path ?? "file")}
            oldText={String(input().oldString ?? "")}
            newText={String(input().newString ?? "")}
          />
        </Show>

        <Show when={kind() === "write" && typeof input().content === "string"}>
          <SimpleCode file={String(input().filePath ?? input().path ?? "file")} code={String(input().content)} />
        </Show>

        <Show when={kind() === "read" && output()}>
          <SimpleCode file={String(input().filePath ?? input().path ?? "file")} code={output()} />
        </Show>

        <Show when={kind() === "bash"}>
          <div class="terminal">
            <div class="terminal-head">bash</div>
            <pre>
              <span class="text-emerald-400">$</span> {String(input().command ?? input().cmd ?? "")}
              {output() ? `\n${output()}` : ""}
            </pre>
          </div>
        </Show>

        <Show
          when={
            !(
              (kind() === "edit" && input().oldString !== undefined) ||
              (kind() === "write" && typeof input().content === "string") ||
              (kind() === "read" && output()) ||
              kind() === "bash"
            )
          }
        >
          <JsonBlock label="input" value={input()} />
          <Show when={output()}>
            <div>
              <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">output</div>
              <pre class="max-h-[50vh] overflow-auto rounded-md border border-[var(--line)] bg-[var(--page)] p-3 text-xs leading-6 whitespace-pre-wrap">
                {output()}
              </pre>
            </div>
          </Show>
        </Show>
      </div>
    </details>
  )
}

function JsonBlock(props: { label: string; value: unknown }) {
  let text = ""
  try {
    text = JSON.stringify(props.value, null, 2)
  } catch {
    text = String(props.value)
  }
  if (text.length > 80_000) text = `${text.slice(0, 80_000)}\n… [truncated]`
  return (
    <div>
      <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">{props.label}</div>
      <pre class="max-h-[40vh] overflow-auto rounded-md border border-[var(--line)] bg-[var(--page)] p-3 text-xs leading-6 whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

function SimpleCode(props: { file: string; code: string }) {
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

function DiffView(props: { file: string; oldText: string; newText: string }) {
  const rows = createMemo(() => {
    let oldLines = props.oldText.split("\n")
    let newLines = props.newText.split("\n")
    if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines = oldLines.slice(0, -1)
    if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines = newLines.slice(0, -1)
    const max = Math.max(oldLines.length, newLines.length)
    const result: { type: "ctx" | "add" | "del"; text: string }[] = []
    for (let index = 0; index < max; index++) {
      const oldLine = oldLines[index]
      const newLine = newLines[index]
      if (oldLine === newLine) result.push({ type: "ctx", text: oldLine ?? "" })
      else {
        if (oldLine !== undefined) result.push({ type: "del", text: oldLine })
        if (newLine !== undefined) result.push({ type: "add", text: newLine })
      }
    }
    return result
  })

  return (
    <div>
      <div class="mb-1 truncate text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">{props.file}</div>
      <div class="diff">
        <For each={rows()}>
          {(row) => (
            <div class={`diff-row ${row.type === "add" ? "add" : row.type === "del" ? "del" : ""}`}>
              <span class="diff-sign">{row.type === "add" ? "+" : row.type === "del" ? "-" : " "}</span>
              <span class="diff-line">{row.text || " "}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
