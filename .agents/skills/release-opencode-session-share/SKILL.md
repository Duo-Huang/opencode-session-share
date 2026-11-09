---
name: release-opencode-session-share
description: Cut, publish, and deploy an opencode-session-share service-only or full plugin/service release.
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

Before choosing a tag, run:

```bash
last="$(git describe --tags --abbrev=0)"
git diff --name-only "$last"..HEAD -- plugin/src plugin/package.json \
  | grep -v '\.test\.ts$' || true
```

If this prints anything, use a full `vX.Y.Z` release, not
`service-vX.Y.Z`. Do not classify from the viewer diff alone.

## Flow

1. Classify the release using `CONTRIBUTING.md`.
2. Run the checks it lists.
3. Create and push the tag.
4. Wait for the Release workflow to succeed.
5. Verify what it published, then deploy per `docs/self-hosting.md`.

Do not copy release commands or deployment details into this skill.
