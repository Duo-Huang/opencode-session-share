import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { SessionShareRpc } from "./rpc"

type Prepared = {
  consentRequired: boolean
  share: { id: string; url: string; expiresAt: number } | null
}

type Shared = {
  id: string
  url: string
  expiresAt: number
}

function runClipboardCommand(command: string, args: string[], text: string) {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] })
      child.on("error", () => resolve(false))
      child.on("close", (code) => resolve(code === 0))
      child.stdin.end(text)
    } catch {
      resolve(false)
    }
  })
}

async function copyToClipboard(context: any, text: string) {
  try {
    if (context.renderer.copyToClipboardOSC52(text)) return true
  } catch {}

  if (process.platform === "darwin") return runClipboardCommand("pbcopy", [], text)
  if (process.platform === "win32") return runClipboardCommand("clip", [], text)
  if (process.platform === "linux") {
    if (await runClipboardCommand("wl-copy", [], text)) return true
    if (await runClipboardCommand("xclip", ["-selection", "clipboard"], text)) return true
    return runClipboardCommand("xsel", ["--clipboard", "--input"], text)
  }
  return false
}

async function copyAndToast(context: any, url: string) {
  const copied = await copyToClipboard(context, url)
  context.ui.toast.show({
    message: copied ? "Share URL copied to clipboard!" : `Share URL: ${url}`,
    variant: copied ? "success" : "warning",
  })
}

function currentSessionID(context: any): string | undefined {
  const route = context.ui.router.current()
  return route?.type === "session" ? route.sessionID : undefined
}

export default Plugin.define({
  id: "opencode-session-share.tui",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-session-share.share",
          title: "Share session via public link",
          description: "Create or reuse a link anyone on the internet can open",
          group: "Session",
          slash: { name: "share" },
          run: async () => {
            const sessionID = currentSessionID(context)
            if (!sessionID) {
              context.ui.toast.show({ message: "No active session", variant: "warning" })
              return
            }

            try {
              const rpc = context.client.rpc(SessionShareRpc)
              const prepared = (await rpc.prepareShare({ sessionID })) as Prepared
              if (prepared.share) {
                await copyAndToast(context, prepared.share.url)
                return
              }

              if (prepared.consentRequired) {
                const ok = await context.ui.dialog.confirm({
                  title: "Share session publicly?",
                  message:
                    "Anyone on the internet with the link can view this session, including tool output and shell commands.",
                  label: { confirm: "Share publicly", cancel: "Cancel" },
                })
                if (ok !== true) return
              }

              const shared = (await rpc.share({ sessionID, consent: true })) as Shared
              await copyAndToast(context, shared.url)
            } catch (error) {
              context.ui.toast.show({
                message: error instanceof Error ? error.message : "Failed to share session",
                variant: "error",
              })
            }
          },
        },
        {
          id: "opencode-session-share.unshare",
          title: "Revoke public share link",
          description: "Revoke the public link and stop syncing this session",
          group: "Session",
          slash: { name: "unshare" },
          run: async () => {
            const sessionID = currentSessionID(context)
            if (!sessionID) {
              context.ui.toast.show({ message: "No active session", variant: "warning" })
              return
            }

            try {
              await context.client.rpc(SessionShareRpc).unshare({ sessionID })
              context.ui.toast.show({ message: "Session unshared successfully", variant: "success" })
            } catch (error) {
              context.ui.toast.show({
                message: error instanceof Error ? error.message : "Failed to unshare session",
                variant: "error",
              })
            }
          },
        },
      ],
    }))
  },
})
