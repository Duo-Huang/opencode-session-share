# OpenCode Session Share

[![npm](https://img.shields.io/npm/v/opencode-session-share-plugin.svg)](https://www.npmjs.com/package/opencode-session-share-plugin)
[![CI](https://github.com/Duo-Huang/opencode-session-share/actions/workflows/ci.yml/badge.svg)](https://github.com/Duo-Huang/opencode-session-share/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Share an OpenCode v2 session through a self-hosted, read-only web page.

> **Requirements**
>
> - **OpenCode v2 only.** This plugin uses the OpenCode v2 server, TUI, and RPC plugin APIs.
> - **TUI only.** `/share` and `/unshare` are not available in the Desktop/Web app composer yet.
> - **A self-hosted service is required.** This repository does not provide a hosted service.

## Features

- Share the current session with `/share` and copy the public URL.
- Revoke the link with `/unshare`.
- Live updates through WebSocket.
- Complete user/assistant text; thinking and tool details load on demand.
- Complete directory index and user/assistant search.
- Message-based pagination that never splits a message.
- 1-day fixed TTL; content syncs never extend it.
- Live activity indicator while an agent turn is still running.
- Optional Cloudflare edge cache; the service also works without Cloudflare.

## Quick start

### 1. Start the service

```bash
git clone https://github.com/Duo-Huang/opencode-session-share.git
cd opencode-session-share
cp .env.example .env
```

Generate secrets:

```bash
openssl rand -hex 32   # SHARE_KEYS secret
openssl rand -hex 32   # SHARE_SESSION_SALT
```

Edit `.env`:

```bash
SHARE_KEYS=my-device:<first-secret>
SHARE_SESSION_SALT=<second-secret>
SHARE_PUBLIC_BASE_URL=http://localhost:47821
```

Start:

```bash
docker compose up -d --build
curl http://localhost:47821/healthz
```

Or use the published image:

```bash
docker compose -f compose.ghcr.yml up -d
```

Pin `SHARE_VERSION` in `.env` for reproducible deployments.

For public use, put an HTTPS reverse proxy in front of port `47821` and set
`SHARE_PUBLIC_BASE_URL` to that public URL. See
[docs/self-hosting.md](docs/self-hosting.md) for the full deployment guide.

### 2. Install the plugin

```bash
opencode plugin add opencode-session-share-plugin
```

The CLI only adds a string entry. Replace it with an object containing the
required options:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-session-share-plugin",
      "options": {
        "endpoint": "https://share.example.com",
        "keyId": "my-device",
        "key": "<secret from SHARE_KEYS>"
      }
    }
  ]
}
```

Do not keep both the string entry and the object entry.

### 3. Use it

```text
/reload
/share
/unshare
```

The first `/share` asks for confirmation and warns that the link is public.
Consent is global per OpenCode installation; later shares in other sessions
do not prompt again. `/unshare` does not reset that consent.

## Configuration

### Plugin options

| Option | Required | Description |
|---|---|---|
| `endpoint` | yes | Base URL of the self-hosted service. |
| `keyId` | yes | Device id before `:` in `SHARE_KEYS`. |
| `key` | yes | Secret after `:` in `SHARE_KEYS`. |
| `uploadBudget` | no | Initial `/share` upload budget in bytes (default `524288`). The full snapshot syncs immediately afterwards; raise to `1048576`–`2097152` on fast/LAN links. |

### Service environment

| Variable | Default | Description |
|---|---|---|
| `SHARE_KEYS` | required | `device-id:secret` entries, comma-separated. |
| `SHARE_SESSION_SALT` | required | Stable HMAC salt for session lookup. |
| `SHARE_PUBLIC_BASE_URL` | required | Public URL used in returned share links. |
| `SHARE_DEFAULT_TTL_DAYS` | `1` | Fixed lifetime of a share from creation. |
| `SHARE_MAX_TTL_DAYS` | `30` | Maximum accepted lifetime. |
| `SHARE_TOMBSTONE_DAYS` | `7` | How long revoked share metadata is retained. |
| `SHARE_MAX_BYTES` | `15728640` | Maximum stored snapshot size. |
| `SHARE_VIEW_MAX_BYTES` | `131072` | Page payload target for initial, `around`, `start`, and `before` pages. |
| `SHARE_DB_MAX_MB` | `1024` | SQLite size limit. |
| `CF_ZONE_ID` | empty | Optional Cloudflare cache purge. |
| `CF_CACHE_PURGE_TOKEN` | empty | Optional Cloudflare cache purge. |

Per-share TTL is not exposed in the plugin yet; the service default applies at
creation. Later session changes never extend it. Cloudflare is optional. Without it, public API responses use `no-store` and the
service still works.

### Page-size tuning

`SHARE_VIEW_MAX_BYTES` applies to every viewer page, not just the first one.
Changing it requires a service restart; existing shares do not need to be
uploaded again.

| Scenario | Suggested value |
|---|---|
| Default / mobile / slow links | `131072` (128KB) |
| Fast links or LAN | `262144`–`524288` (256–512KB) |
| Local-only or very fast links | `1048576`+ (1MB+) |

Larger pages reduce pagination and gap fills, but increase first paint time,
viewer memory, and the number of messages loaded at once. Keep it below
`SHARE_MAX_BYTES`.

## Upgrade

For an unpinned package entry:

```bash
opencode plugin check
opencode plugin update opencode-session-share-plugin
```

Then run `/reload`, or restart the OpenCode service if needed.

`opencode plugin update` updates the installed package but does not modify
`options` in `opencode.jsonc`. Endpoint, keyId, and key stay as configured.

v0.3.4 keeps assistant blocks mounted while streaming, keeps the New messages
prompt stable at the tail, scopes share storage per endpoint, excludes
compaction notices from turn counts, and makes terminal colors and theme
switching follow light/dark atomically. It requires service API version 3;
upgrade the service and plugin together.

If you pin an exact version:

```jsonc
"package": "opencode-session-share-plugin@0.3.4"
```

`opencode plugin update` skips it. Change the version manually to upgrade.

## Privacy and security

A share contains the session's active context, including tool inputs/outputs
and shell output. The normalizer replaces project and home paths and strips
terminal control characters, but it is not a full secret scanner.

- Use a private service and HTTPS.
- Use a separate `SHARE_KEYS` entry per device.
- Sync requests use a per-share Ed25519 key; the API key is only used to
  create or revoke shares.
- Keep the TTL short.
- `/unshare` revokes the server-side share, but cannot delete copies already
  saved by recipients, caches, screenshots, or logs.
- Treat the share URL as a public secret: anyone with the link can read it.

## Troubleshooting

- `/share` missing in the app: it is a TUI command; use the terminal UI.
- `missing endpoint` / `missing key`: add the required plugin options.
- `401` / `403`: `keyId` or `key` does not match `SHARE_KEYS`.
- `410 gone`: the share expired or was revoked; run `/share` again.
- Clipboard copy failed: the toast includes the URL so you can copy it manually.
- `plugin update` does nothing: the package may be pinned to an exact version.

## Compatibility

- OpenCode v2 only.
- Service API version `3`.
- TUI commands only; Desktop/Web GUI commands are not implemented yet.

## Contributing

Development and maintainer release instructions live in
[CONTRIBUTING.md](CONTRIBUTING.md). User-facing issues and feature requests are
welcome in GitHub Issues.

## License

MIT
