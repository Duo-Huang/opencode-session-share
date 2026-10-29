# OpenCode Session Share

Share an OpenCode session through a self-hosted, read-only web page.

- **Service**: Bun + Hono + SQLite
- **Viewer**: SolidJS + Vite + Tailwind
- **Plugin**: OpenCode server RPC + TUI commands (`/share`, `/unshare`)
- **Public page**: `https://your-domain.example/s/<share-id>`

The viewer shows the session's **active context** — the messages after the last compaction — plus a collapsible compaction summary. It is not a full pre-compaction history export.

> **Requirements:** OpenCode **v2 only**. The plugin uses the OpenCode v2 server, TUI, and RPC plugin APIs. `/share` and `/unshare` are TUI commands only; the Desktop/Web app composer does not expose them yet.

## Features

- Share a session with one command and copy the URL automatically.
- Live updates through WebSocket.
- Full body text is never truncated. Thinking/tool details load on demand.
- The directory rail and Contents panel use a complete lightweight index.
- Scroll pagination loads complete messages only; a message is never split.
- Contents search covers user and assistant text across the whole share.
- 1-day default TTL, explicit `/unshare`, and server-side revocation.
- Optional Cloudflare edge cache with exact purge; works without Cloudflare too.

## Self-host the service

Requirements: Docker with the Compose plugin, and a public HTTPS address if you want to share outside your LAN.

```bash
git clone https://github.com/Duo-Huang/opencode-session-share.git
cd opencode-session-share
cp .env.example .env

# Generate secrets:
openssl rand -hex 32   # SHARE_KEYS secret
openssl rand -hex 32   # SHARE_SESSION_SALT
```

Edit `.env`:

```bash
SHARE_KEYS=my-mac:<the-first-generated-secret>
SHARE_SESSION_SALT=<the-second-generated-secret>
SHARE_PUBLIC_BASE_URL=http://localhost:47821
```

Start the service:

```bash
docker compose up -d --build
curl http://localhost:47821/healthz
```

Open:

```text
http://localhost:47821/s/<share-id>
```

The SQLite database lives in the `opencode-session-share-data` volume. Keep it if you want shares to survive container recreation.

### Use the published image

If you do not want to build locally:

```bash
cp .env.example .env
# edit .env
docker compose -f compose.ghcr.yml up -d
```

Pin `SHARE_VERSION` in `.env` to a released tag for reproducible deployments.

### Public HTTPS

For a public deployment:

1. Put Caddy, Nginx, or Cloudflare Tunnel in front of port `47821`.
2. Set `SHARE_PUBLIC_BASE_URL` to the public HTTPS URL, for example `https://share.example.com`.
3. Do not expose plain HTTP directly to the internet.
4. If you enable Cloudflare edge caching, configure a cache-purge token. Without `CF_ZONE_ID` and `CF_CACHE_PURGE_TOKEN`, the public API uses `no-store`; the service still works, just without edge caching.

The `SHARE_PUBLIC_BASE_URL` value is used in returned share URLs. It must be the URL users can actually open.

## Install the plugin

### Install with the CLI

```bash
opencode plugin add opencode-session-share-plugin
```

The CLI only installs the package and adds a string entry:

```jsonc
"plugins": ["opencode-session-share-plugin"]
```

This plugin requires options, so replace that string with an object:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-session-share-plugin",
      "options": {
        "endpoint": "https://share.example.com",
        "keyId": "my-mac",
        "key": "<the secret from SHARE_KEYS>"
      }
    }
  ]
}
```

Do not keep both the string entry and the object entry.

### Manual install

Add the object above directly to `~/.config/opencode/opencode.jsonc`.

- `endpoint` is the service base URL. It is required.
- `keyId` must match the id before `:` in `SHARE_KEYS`.
- `key` must match the secret after `:` in `SHARE_KEYS`.
- For local testing, use `endpoint: "http://localhost:47821"`.

The plugin sends `Authorization: Bearer <key>` and `x-share-key-id`. The service checks both against `SHARE_KEYS`.

### Upgrade

For an unpinned package entry:

```bash
opencode plugin check
opencode plugin update opencode-session-share-plugin
```

Then run `/reload`, or `opencode service restart` if the TUI did not pick it up.

`opencode plugin update` updates the installed npm package but does **not**
modify `options` in `opencode.jsonc`. Your endpoint, keyId, and key stay as
configured.

If you pin an exact version:

```jsonc
"package": "opencode-session-share-plugin@0.1.3"
```

`opencode plugin update` skips it. Change the version manually to upgrade.

### Commands

In the TUI:

```text
/share
/unshare
```

On the first `/share` for this OpenCode installation, the TUI asks for confirmation and warns that the link is public. Consent is stored globally per OpenCode installation; later shares, including in different sessions, do not prompt again. `/unshare` does not reset that consent. Upgrading from an older consent version prompts once again for the updated public-link warning. `/share` copies the URL to the clipboard. If clipboard access fails, the toast shows the URL so you can copy it manually.

The Desktop/Web app composer does not currently expose these commands. The plugin ships TUI commands only; a GUI part is a separate future change.

## Privacy and security

The shared snapshot includes:

- user and assistant text;
- visible compaction summaries;
- thinking text (lazy-loaded in the viewer);
- tool names, inputs, outputs, errors, and durations (lazy-loaded);
- shell commands and outputs;
- session title, agent, model, and token/cost metadata.

The normalizer replaces the project directory with `<project>` and the user's home directory with `~`, and strips ANSI/control characters. **It is not a full secret scanner.** Tool inputs or outputs can still contain API keys, tokens, `.env` contents, or other sensitive data.

Use a private service, HTTPS, per-device keys, and a short TTL. `/unshare` revokes the server-side record, but it cannot remove copies already saved by recipients, browser caches, screenshots, or logs.

## Development

Plugin:

```bash
cd plugin
bun install
bun run typecheck
bun test
```

Service:

```bash
cd service
bun install
bun test
bun run build
bun run dev
```

To debug locally, point OpenCode at the plugin directory and the service at localhost:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-session-share/plugin",
      "options": {
        "endpoint": "http://localhost:47821",
        "keyId": "dev",
        "key": "<local SHARE_KEYS secret>"
      }
    }
  ]
}
```

Running the service from source:

```bash
docker compose up -d --build
# or
cd service && bun run dev
```

## API compatibility

The service exposes `x-share-api-version` on `/api/*` responses. The plugin expects API version `1` and rejects a service with a different version. Keep the plugin and service on the same release tag when possible.

## Releases

A tag matching `v*` runs `.github/workflows/release.yml`:

- builds and publishes the multi-arch GHCR image;
- publishes the plugin to npm if `NPM_TOKEN` is configured in the repository secrets.

Before publishing the plugin manually:

```bash
cd plugin
bun test
bunx tsc --noEmit
npm pack --dry-run
npm publish --access public
```

## License

MIT
