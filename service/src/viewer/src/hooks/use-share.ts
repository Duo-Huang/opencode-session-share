import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { captureAnchor, restoreAnchorInDom, type ViewAnchor } from "../view-anchor"
import {
  DEFAULT_VIEW_MAX_BYTES,
  LOADED_BYTES_MULTIPLIER,
  MIN_LOADED_BYTES,
  mergeLoadedRanges,
  planLiveChange,
  trimLoadedRanges,
  trimToTotal,
} from "../view-state"
import {
  AUTO_FILL_MAX_PAGES,
  STATUS_MAX_MS,
  STATUS_POLL_MS,
  STATUS_RETRY_MS,
  WS_WATCHDOG_MS,
  reconnectDelays,
} from "../lib/constants"
import { formatDuration } from "../lib/format"
import { hasAfter, hasBefore, modelLabels, toShareView } from "../lib/share-view"
import { buildDisplayTurns } from "../lib/turns"
import type { LiveUpdate, PageData, PublicShare, ShareView, Status } from "../lib/types"

export function useShare(id: string, options: { getAnchorId: () => string }) {
  const [view, setView] = createSignal<ShareView | null>(null)
  const [status, setStatus] = createSignal<Status>("loading")
  const [error, setError] = createSignal("")
  const [clock, setClock] = createSignal(Date.now())
  const [showTop, setShowTop] = createSignal(false)
  const [showBottom, setShowBottom] = createSignal(false)
  const [loadingPage, setLoadingPage] = createSignal(false)
  const [loadingTail, setLoadingTail] = createSignal(false)
  const [newMessages, setNewMessages] = createSignal(false)
  const [scrollTick, setScrollTick] = createSignal(0)
  const [scrollDirection, setScrollDirection] = createSignal<"up" | "down">("down")
  const [pendingTarget, setPendingTarget] = createSignal("")
  const [pendingAnchor, setPendingAnchor] = createSignal<ViewAnchor | undefined>()

  let pageRequest = 0
  let lastScrollY = 0

  let socket: WebSocket | undefined
  let reconnectTimer: number | undefined
  let attempt = 0
  let closed = false
  let generation = 0
  let refreshing = false
  let pendingFresh = false
  let statusTimer: number | undefined
  let statusDelay = STATUS_POLL_MS
  let statusChecking = false
  let statusController: AbortController | undefined
  let lastFrameAt = 0
  let activeFrame: number | undefined

  const applySnapshot = (data: PublicShare) => {
    const current = view()
    if (!current) {
      setView(toShareView(data))
      return
    }
    if (data.updatedAt <= current.updatedAt) return

    const { messages: _messages, page: _page, ...meta } = data
    const plan = planLiveChange(current, {
      total: data.page.total,
      reverted: data.session.reverted,
    })

    if (plan.kind === "trim") {
      const anchor = captureAnchor(options.getAnchorId())
      const trimmed = trimToTotal(current.messages, current.ranges, data.page.total)
      ++pageRequest
      setLoadingPage(false)
      setLoadingTail(false)
      setView({
        ...current,
        ...meta,
        messages: trimmed.messages,
        ranges: trimmed.ranges,
        total: data.page.total,
      })
      setNewMessages(false)
      setPendingAnchor(anchor)
      return
    }

    if (plan.kind === "reset") {
      const anchor = captureAnchor(options.getAnchorId())
      ++pageRequest
      setLoadingPage(false)
      setLoadingTail(false)
      setView(toShareView(data))
      setPendingAnchor(anchor)
      return
    }

    const onlyInitialRange = current.ranges.length === 1 && current.ranges[0].start === 0
    // Keep the initial window fresh for streaming content, matching the old
    // single-window behavior. Once the reader has jumped, historical ranges
    // stay put and only metadata is refreshed.
    if (onlyInitialRange && data.page.start === 0 && current.ranges[0].end <= data.page.end) {
      setView(toShareView(data))
      return
    }

    setView({
      ...current,
      ...meta,
      messages: current.messages,
      ranges: current.ranges,
      total: data.page.total,
    })
    if (plan.kind === "append") setNewMessages(true)
  }

  const fetchPage = async (
    cursor: { start?: number; before?: number; around?: number },
    signal?: AbortSignal,
  ): Promise<PageData> => {
    const query = new URLSearchParams()
    if (cursor.start !== undefined) query.set("start", String(cursor.start))
    if (cursor.before !== undefined) query.set("before", String(cursor.before))
    if (cursor.around !== undefined) query.set("around", String(cursor.around))
    const response = await fetch(
      `/api/public/shares/${encodeURIComponent(id)}/messages?${query.toString()}`,
      { cache: "no-store", signal },
    )
    if (response.status === 410) {
      markRevoked()
      throw new Error("revoked")
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as PageData
  }

  const insertPage = (data: PageData, evict = false) => {
    setView((current) => {
      if (!current) return current
      const messages = new Map(current.messages)
      data.messages.forEach((message, offset) => messages.set(data.page.start + offset, message))
      const ranges = mergeLoadedRanges([
        ...current.ranges,
        ...(data.page.end > data.page.start
          ? [
              {
                start: data.page.start,
                end: data.page.end,
                bytes: data.page.bytes ?? 0,
                touchedAt: Date.now(),
              },
            ]
          : []),
      ])
      // Only jumps enforce the bounded cache. Sequential scrolling and gap
      // loading keep their content; evicting an above-viewport range there
      // would shift the reader's scroll position.
      if (evict) {
        const limit = current.limits?.viewMaxBytes ?? DEFAULT_VIEW_MAX_BYTES
        const maxBytes = Math.max(MIN_LOADED_BYTES, limit * LOADED_BYTES_MULTIPLIER)
        trimLoadedRanges(ranges, messages, data.page.start, data.page.total, maxBytes)
      }
      return {
        ...current,
        limits: data.limits ?? current.limits,
        messages,
        ranges,
        total: Math.max(current.total, data.page.total, data.page.end),
        privacy: data.privacy ?? current.privacy,
        updatedAt: Math.max(current.updatedAt, data.updatedAt),
      }
    })
  }

  const fillAdjacentGaps = async (request: number, targetIndex: number) => {
    const current = view()
    if (!current) return
    const targetRange = current.ranges.find(
      (range) => targetIndex >= range.start && targetIndex < range.end,
    )
    if (!targetRange) return

    // One page from the target side of the preceding gap. The page ends at
    // targetRange.start, so it always merges with the target range.
    const index = current.ranges.indexOf(targetRange)
    const previous = index > 0 ? current.ranges[index - 1] : undefined
    if (targetRange.start > 0 && (!previous || previous.end < targetRange.start)) {
      const data = await fetchPage({ before: targetRange.start })
      if (request !== pageRequest) return
      insertPage(data, true)
    }

    // Re-read the target after the insert: the preceding page may have merged.
    const updated = view()
    const updatedTarget = updated?.ranges.find(
      (range) => targetIndex >= range.start && targetIndex < range.end,
    )
    if (!updated || !updatedTarget) return
    const updatedIndex = updated.ranges.indexOf(updatedTarget)
    const next =
      updatedIndex + 1 < updated.ranges.length ? updated.ranges[updatedIndex + 1] : undefined
    if (updatedTarget.end < updated.total && (!next || next.start > updatedTarget.end)) {
      const data = await fetchPage({ start: updatedTarget.end })
      if (request !== pageRequest) return
      insertPage(data, true)
    }
  }

  const loadGap = async (start: number, end: number, direction: "up" | "down") => {
    const current = view()
    if (!current || loadingPage()) return
    const request = ++pageRequest
    const height = document.documentElement.scrollHeight
    const top = window.scrollY
    setLoadingPage(true)
    try {
      if (direction === "up") {
        // Fill backward from the target/lower side so the nearest messages
        // appear first. The height adjustment keeps the reader's content in
        // place while the new page is inserted above the viewport.
        let cursor = end
        for (let page = 0; page < AUTO_FILL_MAX_PAGES && cursor > start; page++) {
          const data = await fetchPage({ before: cursor })
          if (request !== pageRequest) return
          insertPage(data)
          if (data.page.start >= cursor) break
          cursor = data.page.start
        }
        if (request === pageRequest) {
          queueMicrotask(() => {
            requestAnimationFrame(() => {
              const delta = document.documentElement.scrollHeight - height
              if (delta > 0) window.scrollTo({ top: top + delta, behavior: "auto" })
            })
          })
        }
      } else {
        let cursor = start
        for (let page = 0; page < AUTO_FILL_MAX_PAGES && cursor < end; page++) {
          const data = await fetchPage({ start: cursor })
          if (request !== pageRequest) return
          insertPage(data)
          if (data.page.end <= cursor) break
          cursor = data.page.end
        }
      }
    } catch {
      // Keep the gap; the reader can retry.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const loadNextPage = async (force = false) => {
    const current = view()
    const last = current?.ranges.at(-1)
    if (!current || !last || loadingPage() || (!force && !hasAfter(current))) return
    const follow =
      force &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ start: last.end })
      if (request !== pageRequest) return
      insertPage(data)
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
    const current = view()
    const first = current?.ranges[0]
    if (!current || !first || loadingPage() || !hasBefore(current)) return
    const request = ++pageRequest
    const height = document.documentElement.scrollHeight
    const top = window.scrollY
    setLoadingPage(true)
    try {
      const data = await fetchPage({ before: first.start })
      if (request !== pageRequest) return
      insertPage(data)
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
    const current = view()
    if (!current || loadingPage()) return
    const request = ++pageRequest
    setLoadingPage(true)
    setLoadingTail(true)
    try {
      const data = await fetchPage({ before: current.total })
      if (request !== pageRequest) return
      insertPage(data, true)
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
      setLoadingTail(false)
    }
  }

  const goToFirstPage = async () => {
    const current = view()
    if (!current || loadingPage()) return
    if (!hasBefore(current)) {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ start: 0 })
      if (request !== pageRequest) return
      insertPage(data, true)
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
    const current = view()
    if (current && hasAfter(current)) {
      void loadTail()
      return
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
  }

  const jumpToTarget = async (target: string, messageIndex: number) => {
    const existing = document.getElementById(target)
    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    const current = view()
    if (!current || loadingPage()) return
    const targetIndex = /^[mp]-(\d+)/.exec(target)?.[1]
    const around = targetIndex === undefined ? messageIndex : Number(targetIndex)
    const request = ++pageRequest
    setLoadingPage(true)
    try {
      const data = await fetchPage({ around })
      if (request !== pageRequest) return
      insertPage(data, true)
      await fillAdjacentGaps(request, Math.max(0, Math.min(around, data.page.total - 1)))
      if (request !== pageRequest) return
      setPendingTarget(target)
    } catch {
      // Leave the loaded ranges in place.
    } finally {
      if (request === pageRequest) setLoadingPage(false)
    }
  }

  const applyLiveUpdate = (data: LiveUpdate) => {
    const current = view()
    if (!current) {
      void refresh(true)
      return
    }
    if (data.updatedAt <= current.updatedAt) return

    const metadata = {
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
    }
    const plan = planLiveChange(current, {
      total: data.total,
      reverted: data.session.reverted,
    })

    if (plan.kind === "trim") {
      const anchor = captureAnchor(options.getAnchorId())
      const trimmed = trimToTotal(current.messages, current.ranges, data.total)
      ++pageRequest
      setLoadingPage(false)
      setLoadingTail(false)
      setView({
        ...current,
        ...metadata,
        messages: trimmed.messages,
        ranges: trimmed.ranges,
        total: data.total,
      })
      setNewMessages(false)
      setPendingAnchor(anchor)
      return
    }

    if (plan.kind === "reset") {
      const anchor = captureAnchor(options.getAnchorId())
      ++pageRequest
      setLoadingPage(false)
      setLoadingTail(false)
      setView(null)
      setPendingAnchor(anchor)
      void refresh(true)
      return
    }

    setView({ ...current, ...metadata, total: data.total })

    if (plan.kind === "append") {
      setNewMessages(true)
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240
      if (atBottom && !hasAfter(current)) void loadNextPage(true)
    }
  }

  function clearStatusTimer() {
    if (statusTimer !== undefined) {
      window.clearTimeout(statusTimer)
      statusTimer = undefined
    }
  }

  function markRevoked() {
    closed = true
    generation++
    clearStatusTimer()
    statusController?.abort()
    statusController = undefined
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    ++pageRequest
    setLoadingPage(false)
    setLoadingTail(false)
    setView(null)
    setStatus("revoked")
    socket?.close()
  }

  function scheduleStatus(delay = statusDelay) {
    if (closed || document.visibilityState !== "visible") return
    clearStatusTimer()
    statusTimer = window.setTimeout(() => {
      statusTimer = undefined
      void checkStatus()
    }, delay)
  }

  async function checkStatus() {
    if (closed || document.visibilityState !== "visible" || statusChecking) return
    if (status() === "revoked") return

    statusChecking = true
    statusController?.abort()
    const controller = new AbortController()
    statusController = controller
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(id)}/status?fresh=${Date.now()}`,
        { cache: "no-store", signal: controller.signal },
      )
      if (closed) return
      if (response.status === 410 || response.status === 404) {
        markRevoked()
        return
      }
      if (!response.ok) return

      const data = (await response.json()) as { updatedAt: number; expiresAt: number }
      if (closed) return
      const current = view()
      if (!current || data.updatedAt > current.updatedAt) {
        await refresh(true)
      } else {
        setClock(Date.now())
      }
    } catch {
      // Network failure: keep the current page and retry on the schedule.
    } finally {
      if (statusController === controller) statusController = undefined
      statusChecking = false
      if (!closed) {
        if (status() === "reconnecting") {
          scheduleStatus(statusDelay)
          statusDelay = Math.min(statusDelay * 2, STATUS_MAX_MS)
        } else {
          statusDelay = STATUS_POLL_MS
          scheduleStatus(STATUS_POLL_MS)
        }
      }
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
      if (response.status === 410 || response.status === 404) {
        markRevoked()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as PublicShare
      if (closed) return
      applySnapshot(data)
      setClock(Date.now())
      setStatus((current) =>
        current === "revoked" || current === "reconnecting" ? current : "live",
      )
    } catch (cause) {
      // If the socket already delivered a snapshot, a failed fallback fetch
      // should not replace the page with an error screen.
      if (closed || view()) return
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
      lastFrameAt = Date.now()
      setStatus("live")
      statusDelay = STATUS_POLL_MS
      const current = view()
      if (!current) {
        if (!refreshing) void refresh(true)
        scheduleStatus(STATUS_POLL_MS)
      } else {
        void checkStatus()
      }
    }

    ws.onmessage = (event) => {
      if (currentGeneration !== generation) return
      lastFrameAt = Date.now()
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
          statusDelay = STATUS_POLL_MS
          scheduleStatus(STATUS_POLL_MS)
        }
        if (message.type === "revoked") {
          markRevoked()
        }
      } catch {
        // Ignore malformed frames.
      }
    }

    ws.onclose = (event) => {
      if (currentGeneration !== generation) return
      if (closed) return
      if (event.code === 4100 || event.code === 4410) {
        markRevoked()
        return
      }
      lastFrameAt = 0
      setStatus("reconnecting")
      statusDelay = STATUS_RETRY_MS
      void checkStatus()
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
    clearStatusTimer()
    statusController?.abort()
    statusController = undefined
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    socket?.close()
    socket = undefined
  }

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
    scheduleStatus(STATUS_POLL_MS)

    const onScroll = () => {
      const current = view()
      const scrollingUp = window.scrollY < lastScrollY - 2
      if (window.scrollY !== lastScrollY) {
        setScrollDirection(scrollingUp ? "up" : "down")
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700
      const atTop = window.scrollY < 260
      setShowTop(window.scrollY > 400 || (!!current && hasBefore(current)))
      setShowBottom(
        (!!current && hasAfter(current)) ||
          (window.scrollY > 500 &&
            window.innerHeight + window.scrollY < document.body.scrollHeight - 120),
      )
      if (current && atBottom && hasAfter(current)) void loadNextPage()
      if (current && atTop && hasBefore(current) && scrollingUp) void loadPreviousPage()
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
      if (status() === "revoked") return
      closed = false
      setStatus("reconnecting")
      socket?.close()
      connect()
      statusDelay = STATUS_RETRY_MS
      void checkStatus()
    }

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        clearStatusTimer()
        return
      }
      if (closed || status() === "revoked") return

      if (
        !socket ||
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        setStatus("reconnecting")
        connect()
      }
      statusDelay = status() === "reconnecting" ? STATUS_RETRY_MS : STATUS_POLL_MS
      void checkStatus()
    }

    const tick = window.setInterval(() => {
      const now = Date.now()
      setClock(now)
      if (
        socket?.readyState === WebSocket.OPEN &&
        lastFrameAt > 0 &&
        now - lastFrameAt > WS_WATCHDOG_MS
      ) {
        socket.close()
      }
    }, 5000)

    window.addEventListener("scroll", onScroll, { passive: true })
    document.addEventListener("click", onCopy)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => {
      disconnect()
      window.clearInterval(tick)
      if (activeFrame !== undefined) window.cancelAnimationFrame(activeFrame)
      window.removeEventListener("scroll", onScroll)
      document.removeEventListener("click", onCopy)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibility)
    })
  })

  createEffect(() => {
    const current = view()
    document.title = current?.title ? `${current.title} · OpenCode Session` : "OpenCode Session"
  })

  createEffect(() => {
    const target = pendingTarget()
    if (!target) return
    const current = view()
    if (!current) return
    void current.messages.size
    void current.ranges.length
    void current.total
    queueMicrotask(() => {
      const element = document.getElementById(target)
      if (!element) return
      element.scrollIntoView({ behavior: "smooth", block: "start" })
      setPendingTarget("")
    })
  })

  createEffect(() => {
    const anchor = pendingAnchor()
    const current = view()
    if (!anchor || !current || loadingPage()) return
    setPendingAnchor(undefined)
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (anchor.index >= current.total) {
          if (hasAfter(current)) void loadTail()
          else window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" })
          return
        }
        if (restoreAnchorInDom(anchor)) return
        void jumpToTarget(anchor.id, anchor.index)
      })
    })
  })

  createEffect(() => {
    const current = view()
    if (!current || loadingPage() || !hasAfter(current)) return
    void current.ranges.length
    void current.total
    queueMicrotask(() => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 400) {
        void loadNextPage()
      }
    })
  })

  const stats = createMemo(
    () =>
      view()?.stats ?? {
        messages: 0,
        tools: 0,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0 },
      },
  )

  const models = createMemo(() => (view() ? modelLabels(view()!) : []))

  const detailsOmitted = createMemo(() => {
    const privacy = view()?.privacy
    if (!privacy) return false
    if (typeof privacy.detailsOmitted === "boolean") return privacy.detailsOmitted
    return !!privacy.truncated && !privacy.bodyTruncated
  })

  const bodyTruncated = createMemo(() => !!view()?.privacy?.bodyTruncated)

  const liveState = createMemo(() => {
    if (status() === "revoked") return "revoked"
    if (status() === "error") return "offline"
    const current = view()
    if (!current) return "loading"
    if (status() === "reconnecting") return "reconnecting"
    return clock() - current.updatedAt > 90_000 ? "stale" : "live"
  })

  const liveTitle = () => {
    const current = view()
    if (!current) return "Waiting for the first snapshot"
    return `Snapshot updated ${formatDuration(Math.max(0, clock() - current.updatedAt))} ago`
  }

  const displayTurns = createMemo(() => {
    const current = view()
    return current ? buildDisplayTurns(current) : []
  })

  const canLoadBefore = createMemo(() => {
    const current = view()
    return !!current && hasBefore(current)
  })

  const canLoadAfter = createMemo(() => {
    const current = view()
    return !!current && hasAfter(current)
  })

  const lastTextId = createMemo(() => {
    const current = view()
    if (!current || hasAfter(current)) return ""
    const lastRange = current.ranges.at(-1)
    if (!lastRange) return ""
    for (let index = lastRange.end - 1; index >= lastRange.start; index--) {
      const message = current.messages.get(index)
      if (!message || message.role !== "assistant") continue
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
        const part = message.content[partIndex]
        if (part.type === "text" && part.text.trim()) {
          return `p-${index}-${partIndex}`
        }
      }
    }
    return ""
  })

  return {
    view,
    status,
    error,
    stats,
    models,
    detailsOmitted,
    bodyTruncated,
    liveState,
    liveTitle,
    displayTurns,
    lastTextId,
    canLoadBefore,
    canLoadAfter,
    loadingPage,
    loadingTail,
    newMessages,
    scrollTick,
    scrollDirection,
    showTop,
    showBottom,
    loadGap,
    loadNextPage,
    loadPreviousPage,
    loadTail,
    goToFirstPage,
    goToBottom,
    jumpToTarget: (target: string, messageIndex: number) => {
      void jumpToTarget(target, messageIndex)
    },
  }
}
