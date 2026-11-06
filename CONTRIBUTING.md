# Contributing

## Requirements

- Bun 1.3 or newer
- Docker with the Compose plugin, for service/integration work
- OpenCode v2, for manual TUI testing

## Layout

```text
service/   Bun + Hono + SQLite service and Solid viewer
plugin/    OpenCode v2 server, TUI, and RPC plugin
shared/    Shared snapshot types
docs/      User-facing self-hosting and design notes
```

## Setup

```bash
(cd plugin && bun install)
(cd service && bun install)
```

## Checks

Plugin:

```bash
cd plugin
bun run typecheck
bun test
```

Service:

```bash
cd service
bun run typecheck
bun test
bun run build
```

Keep `shared/types.ts` and `plugin/src/types.ts` identical. CI checks this with
`diff -u shared/types.ts plugin/src/types.ts`; update both when changing the
snapshot shape.

## Manual testing

Start the service from the repository root:

```bash
docker compose up -d --build
```

Point the local OpenCode config at the plugin directory:

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

Run `/reload` in the TUI, then test `/share` and `/unshare`.

## Release process

Releases are maintainer-only. Use the smallest release that matches the change:

| Change | Tag | Image | npm |
|---|---|---|---|
| Plugin/TUI behavior, protocol, or both sides | `vX.Y.Z` | yes | yes |
| Viewer/service only | `service-vX.Y.Z` | yes | no |
| Docs, CI, or repo metadata only | — | no | no |

A viewer/service change still ships a new image. Your own deployment pulls the
same GHCR artifact as self-hosters.

Full release:

```bash
# Bump plugin/package.json to X.Y.Z first.
git tag vX.Y.Z
git push origin vX.Y.Z
```

Service-only release:

```bash
git tag service-vX.Y.Z
git push origin service-vX.Y.Z
```

Both tags build and publish the multi-arch GHCR image and update `latest`.
Full releases also publish `opencode-session-share-plugin` to npm through
Trusted Publishing (OIDC); the workflow checks that `vX.Y.Z` matches
`plugin/package.json`. No `NPM_TOKEN` is required.

Do not reuse the same `X.Y.Z` for both a service-only and a full release.
Service-only tags leave `plugin/package.json` unchanged.

### Manual npm fallback

Only package maintainers can publish this npm package. If a tag release cannot
be used, a maintainer can publish interactively:

```bash
cd plugin
bun test
bunx tsc --noEmit
npm pack --dry-run
npm login
npm publish --access public
```

Use normal 2FA. Do not create or share bypass-2FA tokens.

## Pull requests

- Keep user-facing documentation in `README.md` and `docs/`.
- Keep release/development instructions here, not in the public README.
- Add tests for behavior changes.
- Do not commit `.env`, service data, `node_modules`, or built viewer assets.
- The plugin is TUI-only today; Desktop/Web GUI commands are future work.

## License

By contributing, you agree that your changes are licensed under the MIT License.
