import { beforeEach, describe, expect, mock, test } from "bun:test"

type Command = {
  id: string
  title?: string
  description?: string
  slash?: { name: string; arguments?: boolean }
  run: (input?: string) => Promise<void> | void
}

let commands: Command[] = []
let toasts: { message: string; variant?: string }[] = []
let confirmCalls: {
  title: string
  message: string
  label?: { confirm?: string; cancel?: string }
}[] = []

mock.module("@opencode/plugin/tui", () => ({
  Plugin: {
    define: (definition: unknown) => definition,
  },
}))

const { default: plugin } = await import("./tui")

const context = {
  keymap: {
    layer(factory: () => { commands: Command[] }) {
      commands = factory().commands
    },
  },
  ui: {
    router: { current: () => ({ type: "session", sessionID: "ses_test" }) },
    toast: {
      show(options: { message: string; variant?: string }) {
        toasts.push(options)
      },
    },
    dialog: {
      async confirm(options: {
        title: string
        message: string
        label?: { confirm?: string; cancel?: string }
      }) {
        confirmCalls.push(options)
        return true
      },
    },
  },
  client: {
    rpc() {
      return {
        async prepareShare() {
          return { consentRequired: true, share: null }
        },
        async share() {
          return { id: "share_1", url: "https://example.test/s/share_1", expiresAt: Date.now() + 1000 }
        },
        async unshare() {
          return { revoked: true }
        },
      }
    },
  },
  renderer: {
    copyToClipboardOSC52() {
      return true
    },
  },
}

beforeEach(() => {
  commands = []
  toasts = []
  confirmCalls = []
})

describe("TUI share commands", () => {
  test("confirms the public link, copies the URL and toasts", async () => {
    ;(plugin as any).setup(context)
    const share = commands.find((command) => command.id === "opencode-session-share.share")
    expect(share?.slash).toEqual({ name: "share" })
    expect(share?.title).toBe("Share session via public link")
    expect(share?.description).toBe(
      "Create or reuse a link anyone on the internet can open",
    )
    await share!.run()

    expect(confirmCalls).toEqual([
      {
        title: "Share session publicly?",
        message:
          "Anyone on the internet with the link can view this session, including tool output and shell commands.",
        label: { confirm: "Share publicly", cancel: "Cancel" },
      },
    ])
    expect(toasts).toEqual([
      { message: "Share URL copied to clipboard!", variant: "success" },
    ])
  })

  test("unshares with the success toast", async () => {
    ;(plugin as any).setup(context)
    const unshare = commands.find((command) => command.id === "opencode-session-share.unshare")
    expect(unshare?.slash).toEqual({ name: "unshare" })
    expect(unshare?.title).toBe("Revoke public share link")
    expect(unshare?.description).toBe("Revoke the public link and stop syncing this session")
    await unshare!.run()
    expect(toasts).toEqual([
      { message: "Session unshared successfully", variant: "success" },
    ])
  })
})
