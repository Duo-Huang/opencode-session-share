---
name: release-opencode-session-share
description: Cut, publish, and deploy an opencode-session-share service-only, plugin-only, or full plugin/service release.
---

# Release opencode-session-share

Use this skill when asked to release, tag, publish, or deploy.

## Source of truth

Read these from the repository root before acting:

- `CONTRIBUTING.md` — "Checks" and "Release process": release type,
  version bump, checks, and tag commands.
- `.github/workflows/release.yml` — what each tag publishes.
- `docs/self-hosting.md` — `SHARE_VERSION`, deployment, and health checks.

If this skill and the docs disagree, the docs win. Update the docs first, then
this skill.

## Release type check

Before choosing a tag, compare the merged commit with the previous release tag:

```bash
last="$(git describe --tags --abbrev=0)"

git diff --name-only "$last"..HEAD -- plugin/src plugin/package.json \
  | grep -v '\.test\.ts$' || true

git diff --name-only "$last"..HEAD -- service shared Dockerfile .dockerignore compose.yml compose.ghcr.yml \
  | grep -v '\.test\.ts$' || true
```

Classify from the two outputs:

- Both non-empty: use a full `vX.Y.Z` release.
- Only plugin paths: use `plugin-vX.Y.Z`; do not build or deploy the service.
- Only service/shared/Docker paths: use `service-vX.Y.Z`; do not publish npm.
- Both empty: docs/CI/metadata only; do not release.

When unsure, use a full `vX.Y.Z` release. Do not classify from the viewer diff
alone.

## Flow

1. Classify the release using `CONTRIBUTING.md`.
2. Run the checks it lists.
3. Land the release commit on `main` through a pull request; direct pushes are
   blocked.
4. Create and push the tag from the merged `main`.
5. Wait for the Release workflow to succeed.
6. Verify what it published. Deploy the service only for a full or service-only
   release; a plugin-only release updates npm and does not touch the running
   service. The service image and `latest` stay at the previous release.

Do not copy release commands or deployment details into this skill.
