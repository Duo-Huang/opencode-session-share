# opencode-session-share-plugin

TUI commands for sharing an OpenCode session through a self-hosted [OpenCode Session Share](https://github.com/Duo-Huang/opencode-session-share) service.

## Requirements

- **OpenCode v2 only.** This plugin uses the OpenCode v2 server, TUI, and RPC plugin APIs.
- **TUI only.** `/share` and `/unshare` are not available in the Desktop/Web app composer yet.
- OpenCode runs plugins with Bun.
- A running OpenCode Session Share service.
- A `SHARE_KEYS` entry from that service.

The plugin does not ship a hosted service. You must self-host the service or use an instance you trust.

## Install with the CLI

```bash
opencode plugin add opencode-session-share-plugin
```

The CLI only installs the package and adds a string entry:

```jsonc
"plugins": ["opencode-session-share-plugin"]
```

This plugin requires options, so replace that string with:

```jsonc
{
  "package": "opencode-session-share-plugin",
  "options": {
    "endpoint": "https://share.example.com",
    "keyId": "my-mac",
    "key": "<secret from SHARE_KEYS>"
  }
}
```

Do not keep both the string and the object entry.

`endpoint` is required. Do not omit it; the plugin will fail with a clear error instead of guessing a server.

## Manual install

Add the object above directly to `~/.config/opencode/opencode.jsonc`.

## Upgrade

For an unpinned package entry:

```bash
opencode plugin check
opencode plugin update opencode-session-share-plugin
```

Then run `/reload`, or `opencode service restart` if the TUI did not pick it up.

`opencode plugin update` updates the installed npm package but does **not** modify `options` in `opencode.jsonc`. Your endpoint, keyId, and key stay as configured.

If you pin an exact version:

```jsonc
"package": "opencode-session-share-plugin@0.1.3"
```

`opencode plugin update` skips it. Change the version manually to upgrade.

## Commands

```text
/share
/unshare
```

- `/share` creates or reuses a public share link, asks for consent once, and copies the URL.
- `/unshare` revokes the public link and clears the local record.
- Consent is global per OpenCode installation; later sessions do not prompt again. `/unshare` does not reset it. Upgrading from an older consent version prompts once again for the updated public-link warning.
- If clipboard access fails, the toast includes the URL.

These are TUI commands. The Desktop/Web app composer does not currently expose them.

## Self-hosting

See the [self-hosting guide](https://github.com/Duo-Huang/opencode-session-share/blob/main/docs/self-hosting.md) for service setup, environment variables, HTTPS, and optional Cloudflare caching.

The short version:

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

## Contributing

Development setup, tests, and maintainer release steps are in
[CONTRIBUTING.md](https://github.com/Duo-Huang/opencode-session-share/blob/main/CONTRIBUTING.md).

## License

MIT
