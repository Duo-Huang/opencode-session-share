---
name: Release opencode-session-share
description: Plan, publish, and verify an opencode-session-share service-only or full plugin/service release, including GHCR image tags and npm publishing.
---

# Release opencode-session-share

Use this skill when the user asks to cut, publish, or deploy a release.

## Read first

These files are the source of truth. Read them before acting instead of
duplicating their rules from memory:

- `CONTRIBUTING.md` — "Checks" and "Release process".
- `.github/workflows/release.yml` — what each tag builds and publishes.
- `docs/self-hosting.md` — `SHARE_VERSION`, deployment, and health checks.
- `README.md` and `plugin/README.md` — pinned version examples.

## 1. Classify the release

| Change | Tag | Image | npm |
| --- | --- | --- | --- |
| Plugin/TUI behavior, protocol, or both sides | `vX.Y.Z` | yes | yes |
| Viewer/service only | `service-vX.Y.Z` | yes | no |
| Docs, CI, or repo metadata only | none | no | no |

A change under `plugin/` is usually a full release, even if the viewer is the
main feature. Do not label a release service-only just because most files are
viewer files.

Inspect the actual changes since the previous release:

```bash
git describe --tags --abbrev=0
git log --oneline <previous-tag>..HEAD
git diff --stat <previous-tag>..HEAD -- plugin shared service
```

Do not reuse the same `X.Y.Z` for both a service-only and a full release.

## 2. Preflight

Run from the repository root:

```bash
git status --short
git fetch origin
git log --oneline origin/main..HEAD
diff -u shared/types.ts plugin/src/types.ts
(cd plugin && bunx tsc --noEmit && bun test)
(cd service && bunx tsc --noEmit && bun test && bun run build)
```

For a full release:

- Bump `plugin/package.json` to `X.Y.Z`.
- Update pinned version examples in `README.md` and `plugin/README.md`.
- Update `SHARE_VERSION=vX.Y.Z` examples in `docs/self-hosting.md`.
- Commit the release prep before tagging.

For a service-only release:

- Do not bump `plugin/package.json`.
- Commit viewer/service/docs changes normally.

## 3. Tag and push

```bash
git push origin main
git tag <tag>
git push origin <tag>
```

## 4. Watch the workflow

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id> --exit-status
```

The image version is the tag with the `service-` prefix removed. Both tag types
also move `latest`.

Verify artifacts:

```bash
docker pull ghcr.io/duo-huang/opencode-session-share:<image-version>
npm view opencode-session-share-plugin version dist-tags --json
```

The npm check applies only to full `vX.Y.Z` releases.

## 5. Update deployments

For a standalone deployment:

```bash
docker compose -f compose.ghcr.yml pull
docker compose -f compose.ghcr.yml up -d
```

Or pin the release in `.env`:

```bash
SHARE_VERSION=vX.Y.Z
```

If the service is deployed from a separate compose stack, update only the
share service there after the workflow has moved `latest`:

```bash
docker compose pull opencode-session-share
docker compose up -d --no-deps opencode-session-share
docker inspect opencode-session-share \
  --format 'health={{.State.Health.Status}} image={{.Config.Image}} id={{.Image}}'
```

## 6. Smoke test

- `GET /healthz` returns `ok: true` and the expected API version.
- The share HTML references the new viewer asset hash.
- Open a real share and verify the bottom-jump and search-jump behavior.
- For a production smoke test, create a temporary share, test it, then revoke
  it with `DELETE /api/shares/:id` and confirm the public API returns `410`.

## Common pitfalls

- Classifying plugin runtime changes as service-only: npm users would miss
  them.
- Reusing a version number across service-only and full releases.
- Expecting `service-v*` tags to publish npm; they publish the image only.
- Pulling `latest` before the release workflow succeeds.
- Forgetting that both tag types move `latest`; pin `SHARE_VERSION` when
  reproducibility matters.
- Letting `shared/types.ts` and `plugin/src/types.ts` drift.
- Committing `.env`, databases, `dist/`, or generated viewer assets.

## References

- `CONTRIBUTING.md` — release table and exact commands.
- `.github/workflows/release.yml` — tag-to-artifact behavior.
- `docs/self-hosting.md` — `SHARE_VERSION` and deployment.
- `compose.ghcr.yml` and `compose.yml` — image names and ports.
- `README.md` and `plugin/README.md` — upgrade and pinned-version examples.
