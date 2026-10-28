# opencode-session-share-plugin

TUI commands for sharing an OpenCode session through a self-hosted [OpenCode Session Share](https://github.com/Duo-Huang/opencode-session-share) service.

## Requirements

- OpenCode 2.x with TUI plugin support (OpenCode runs plugins with Bun).
- A running OpenCode Session Share service.
- A `SHARE_KEYS` entry from that service.

The plugin does not ship a hosted service. You must self-host the service or use an instance you trust.

## Install

Add the plugin to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-session-share-plugin",
      "options": {
        "endpoint": "https://share.example.com",
        "keyId": "my-mac",
        "key": "<secret from SHARE_KEYS>"
      }
    }
  ]
}
```

`endpoint` is required. Do not omit it; the plugin will fail with a clear error instead of guessing a server.

## Commands

```text
/share
/unshare
```

- `/share` creates or reuses a share, asks for consent once, and copies the URL.
- `/unshare` revokes the share and clears the local record.
- If clipboard access fails, the toast includes the URL.

These are TUI commands. The Desktop/Web app composer does not currently expose them.

## Service setup

Use the [self-host guide](https://github.com/Duo-Huang/opencode-session-share#self-host-the-service). The short version:

```bash
git clone https://github.com/Duo-Huang/opencode-session-share.git
cd opencode-session-share
cp .env.example .env
# edit SHARE_KEYS, SHARE_SESSION_SALT, SHARE_PUBLIC_BASE_URL
docker compose up -d --build
```

Then point `endpoint` at the same service URL.

## Privacy

Shares contain the session's active context, including tool inputs/outputs and shell output. The normalizer replaces project and home paths and strips terminal control characters, but it is not a full secret scanner. Use a private service, HTTPS, per-device keys, and a short TTL.

`/unshare` revokes the server-side share but cannot delete copies already saved by recipients or caches.

## Development

```bash
bun install
bun run typecheck
bun test
```

## License

MIT
