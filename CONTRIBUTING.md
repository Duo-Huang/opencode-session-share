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
bun install --cwd plugin
bun install --cwd service
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

Releases are maintainer-only. A release is driven by a tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag workflow:

- builds and publishes the multi-arch GHCR image;
- publishes `opencode-session-share-plugin` to npm through Trusted Publishing
  (OIDC).

The tag must match `plugin/package.json` version. The workflow verifies this.
No `NPM_TOKEN` is required.

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
