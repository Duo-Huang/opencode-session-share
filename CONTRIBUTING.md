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
| Plugin and service, protocol, or both sides | `vX.Y.Z` | yes | yes |
| Plugin/TUI only | `plugin-vX.Y.Z` | no | yes |
| Viewer/service only | `service-vX.Y.Z` | yes | no |
| Docs, CI, or repo metadata only | — | no | no |

A viewer/service change still ships a new image. Your own deployment pulls the
same GHCR artifact as self-hosters.

A `service-vX.Y.Z` tag is invalid if any non-test file under `plugin/src/`,
`plugin/package.json`, or `shared/` changed since the previous release tag.

A `plugin-vX.Y.Z` tag is invalid if any non-test file under `service/`,
anything under `shared/`, the Docker build inputs (`Dockerfile`,
`.dockerignore`), or the deployment compose files changed since the previous
release tag. Use a full `vX.Y.Z` release when both sides changed or when the
correct classification is unclear. The release workflow checks these guards
before building or publishing.

Land the release commit on `main` through a pull request, then tag the merged
commit:

```bash
git switch main
git pull
git tag vX.Y.Z          # full release
git tag plugin-vX.Y.Z   # plugin-only release
git tag service-vX.Y.Z  # service-only release
git push origin <tag>
```

Full release: bump `plugin/package.json` to `X.Y.Z` in the pull request first,
then use tag `vX.Y.Z`.

Plugin-only release: bump `plugin/package.json` to `X.Y.Z` in the pull
request, leave the service unchanged, then use tag `plugin-vX.Y.Z`.

Service-only release: leave `plugin/package.json` unchanged, then use tag
`service-vX.Y.Z`.

Full releases build and publish both the multi-arch GHCR image and the npm
plugin through Trusted Publishing (OIDC). Plugin-only releases publish npm
only; service-only releases publish the image only. The workflow checks that
the full or plugin-only tag version matches `plugin/package.json`. No
`NPM_TOKEN` is required.

Plugin-only releases do not move the image or `latest`; the service stays at
the last full or service-only release. Service-only releases do not move npm
`latest`; the plugin stays at the last full or plugin-only release.

Do not reuse the same `X.Y.Z` across release types. Tags are immutable: cut a
new version instead of moving or deleting a published tag.

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

## Branches and reviews

`main` only accepts pull requests:

- CI must pass: `plugin`, `service`, and `shared-types`.
- The branch must be up to date with `main` before merging.
- Pull requests are squash-merged, and the branch is deleted after merge.
- No approval is required today, so a maintainer can self-merge once CI is
  green. Add a required reviewer when the project gains maintainers.

Do not force-push or delete `main`. Treat release tags as immutable: cut a new
version instead of moving or deleting a published tag. Only maintainers can
create `v*`, `plugin-v*`, and `service-v*` tags.

## Pull requests

- Keep user-facing documentation in `README.md` and `docs/`.
- Keep release/development instructions here, not in the public README.
- Add tests for behavior changes.
- Do not commit `.env`, service data, `node_modules`, or built viewer assets.
- The plugin is TUI-only today; Desktop/Web GUI commands are future work.

## License

By contributing, you agree that your changes are licensed under the MIT License.
