# Desktop/Web GUI status

The current plugin ships a **TUI** part only.

OpenCode Desktop 2.2.0 supports experimental GUI plugins through a
`./gui-experimental` package export, but this package does not provide that
entry yet. As a result:

- `/share` and `/unshare` work in the TUI;
- the Desktop/Web app composer's `/` menu does not show them.

The server part and RPC are shared. A future GUI part can call the same
`SessionShareRpc` and use the GUI `Command` registry:

```tsx
ctx.add(Command, () => ({
  id: "share",
  title: "Share session",
  slash: { name: "share" },
  run: async () => {
    const session = ctx.sessions.current()
    if (!session) return
    const result = await ctx.client.rpc(SessionShareRpc).share({
      sessionID: session.id,
      consent: true,
    })
    await ctx.system.copy(result.url)
    ctx.toast.show({ variant: "success", title: "Share URL copied to clipboard!" })
  },
}))
```

The GUI part must be built as one CommonJS file with
`@opencode/plugin/gui/vite` and exported as `./gui-experimental`, and the
package must be added to the global `opencode.json(c)` (the Desktop app reads
GUI plugins from the global config).
