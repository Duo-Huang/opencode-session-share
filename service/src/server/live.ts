import { createBunWebSocket } from "hono/bun"
import type { Hono } from "hono"
import { findById } from "./db"

type LiveSocket = {
  send(data: string, options?: { compress?: boolean }): void
  close(code?: number, reason?: string): void
}

const { upgradeWebSocket, websocket } = createBunWebSocket()

const clients = new Map<string, Set<LiveSocket>>()

export { websocket }

export function liveConnectionCount(id: string) {
  return clients.get(id)?.size ?? 0
}

export function broadcastUpdate(id: string, update: unknown) {
  const set = clients.get(id)
  if (!set) return
  const message = JSON.stringify({ type: "update", data: update })
  for (const ws of [...set]) {
    try {
      ws.send(message, { compress: true })
    } catch {
      set.delete(ws)
    }
  }
}

export function revokeLive(id: string) {
  const set = clients.get(id)
  if (!set) return
  for (const ws of [...set]) {
    try {
      ws.send(JSON.stringify({ type: "revoked" }))
      ws.close(4100, "revoked")
    } catch {}
  }
  clients.delete(id)
}

export function closeAllLive() {
  for (const id of [...clients.keys()]) revokeLive(id)
}

export function registerLiveRoutes(app: Hono) {
  app.get(
    "/api/public/shares/:id/stream",
    upgradeWebSocket((c) => {
      const id = c.req.param("id") ?? ""
      return {
        onOpen(_event, ws) {
          if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
            ws.close(4404, "not found")
            return
          }
          const row = findById(id)
          if (!row || row.revoked_at || row.expires_at <= Date.now() || !row.payload) {
            ws.close(4410, "revoked or expired")
            return
          }
          let set = clients.get(id)
          if (!set) {
            set = new Set()
            clients.set(id, set)
          }
          set.add(ws)
          // The initial snapshot comes from the public API (gzip + edge cache).
          // The WebSocket is only the live-update channel, so do not duplicate
          // a potentially multi-megabyte snapshot here.
          ws.send(JSON.stringify({ type: "ready" }))
        },
        onMessage(event, ws) {
          if (event.data === "ping") ws.send("pong")
        },
        onClose(_event, ws) {
          const set = clients.get(id)
          if (!set) return
          set.delete(ws)
          if (set.size === 0) clients.delete(id)
        },
        onError(_event, ws) {
          const set = clients.get(id)
          if (!set) return
          set.delete(ws)
          if (set.size === 0) clients.delete(id)
        },
      }
    }),
  )

  setInterval(() => {
    for (const [id, set] of clients) {
      for (const ws of [...set]) {
        try {
          ws.send("ping")
        } catch {
          set.delete(ws)
        }
      }
      if (set.size === 0) clients.delete(id)
    }
  }, 30_000).unref()
}
