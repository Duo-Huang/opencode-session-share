# Self-hosting

This guide covers the service required by `opencode-session-share-plugin`. The
plugin does not connect to a hosted service.

## Requirements

- Docker with the Compose plugin
- A persistent volume for `/data`
- A public HTTPS URL if you want to share outside your LAN
- A reverse proxy that supports WebSocket for `/stream`

## Quick start

```bash
git clone https://github.com/Duo-Huang/opencode-session-share.git
cd opencode-session-share
cp .env.example .env
```

Generate secrets:

```bash
openssl rand -hex 32   # one SHARE_KEYS secret
openssl rand -hex 32   # SHARE_SESSION_SALT
```

Edit `.env`:

```bash
SHARE_KEYS=my-device:<first-secret>
SHARE_SESSION_SALT=<second-secret>
SHARE_PUBLIC_BASE_URL=http://localhost:47821
```

Start from source:

```bash
docker compose up -d --build
```

Or use the published image:

```bash
docker compose -f compose.ghcr.yml up -d
```

Set `SHARE_VERSION=v0.1.3` in `.env` to pin the image.

Check:

```bash
curl http://localhost:47821/healthz
```

## Environment

| Variable | Default | Description |
|---|---|---|
| `SHARE_KEYS` | required | Comma-separated `device-id:secret` entries. Use one entry per device. |
| `SHARE_SESSION_SALT` | required | Stable HMAC salt for session lookup. Do not rotate casually. |
| `SHARE_PUBLIC_BASE_URL` | required | Public URL returned in share links. |
| `SHARE_DEFAULT_TTL_DAYS` | `1` | Default share lifetime. |
| `SHARE_MAX_TTL_DAYS` | `30` | Maximum accepted share lifetime. |
| `SHARE_MAX_BYTES` | `15728640` | Maximum stored snapshot size. |
| `SHARE_VIEW_MAX_BYTES` | `131072` | First-page payload target. |
| `SHARE_DB_MAX_MB` | `1024` | SQLite size limit. |
| `CF_ZONE_ID` | empty | Optional Cloudflare zone for edge cache purge. |
| `CF_CACHE_PURGE_TOKEN` | empty | Optional Cloudflare purge token. |

`SHARE_PUBLIC_BASE_URL` must be the URL users can actually open. It is not the
internal container address. For local testing it can be
`http://localhost:47821`; for public use it must be the HTTPS URL.

`SHARE_SESSION_SALT` must stay stable. Changing it prevents old shares from
being found by session id.

Each device should have its own `SHARE_KEYS` entry:

```bash
SHARE_KEYS=macmini:<secret-1>,macbook:<secret-2>,laptop:<secret-3>
```

The same id and secret must be configured in that device's plugin options.

## Public HTTPS

Put a reverse proxy in front of the service. Example Caddy:

```caddyfile
share.example.com {
    reverse_proxy 127.0.0.1:47821
}
```

Then set:

```bash
SHARE_PUBLIC_BASE_URL=https://share.example.com
```

Requirements:

- WebSocket must be allowed for `/stream`.
- `/api/shares*` and `/stream` must not be cached.
- The proxy should pass the original host and client IP headers.

## Cloudflare (optional)

Cloudflare is optional. Without `CF_ZONE_ID` and `CF_CACHE_PURGE_TOKEN`, the
service works normally and public API responses use `no-store`.

If you use Cloudflare caching:

- bypass `/api/shares*` and `/stream`;
- cache `/s/*`, `/assets/*`, and `/api/public/shares/*`;
- configure a token with Zone → Cache Purge → Purge;
- set `CF_ZONE_ID` and `CF_CACHE_PURGE_TOKEN`.

Exact purge is needed because share updates and revocation must not leave stale
public content at the edge.

## Data and lifecycle

The SQLite database is stored in the `opencode-session-share-data` volume
(`/data/shares.db`).

- Keep the volume across container recreation.
- Back up the volume if you need to preserve shares.
- Default TTL is 1 day.
- `/unshare` clears the server-side payload, closes live connections, and
  purges the edge cache when configured.
- Expiry uses the same cleanup path as `/unshare`.

## Security

- Always use HTTPS for public deployments.
- Use a separate key for each device.
- Do not expose port `47821` directly to the internet without a proxy.
- Keep the TTL short for sensitive sessions.
- Treat share URLs as public secrets: anyone with a link can read the share.
- `/unshare` cannot delete copies saved by recipients, browser caches,
  screenshots, or logs.

## Troubleshooting

- `healthz` fails: check the container logs and the `.env` values.
- Share URL points to localhost: set `SHARE_PUBLIC_BASE_URL` to the public URL.
- `401`/`403` from the plugin: `keyId` or `key` does not match `SHARE_KEYS`.
- WebSocket does not update: allow `/stream` through the reverse proxy.
- Share returns `410`: it expired or was revoked; run `/share` again.
- Slow first load: this is expected without edge caching; Cloudflare is optional.
