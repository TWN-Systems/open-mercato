# Fix Plan: F08 — GitHub Actions Unpinned Tags

**Severity:** High (raised from Medium — 2026-03-28)
**Status:** Not in any existing spec or roadmap
**Confirmed live:** 9 mutable tags in release.yml and qa-deploy.yml
**Effort:** ~30 min
**Spec reference:** SPEC-061 H4

---

## Threat Context

Active supply chain campaigns (Team PCP and related actors) are currently targeting npm-publishing CI pipelines by compromising GitHub Actions publisher accounts and silently rotating mutable tags (`@v4`, `@v6`) to malicious SHAs. The attack is fully automated, leaves no visible indicator in the workflow file, and executes in CI with access to all repository secrets.

This project's `release.yml` carries `NPM_TOKEN`. A successful compromise means a backdoored version of `create-mercato-app` is published to npm, affecting all downstream users who run `npm create mercato-app`. This is the exact attack surface Team PCP is actively exploiting. Severity raised to High; priority moved to P1.

---

## The Problem

All GitHub Actions workflows use mutable major-version tags (`@v4`, `@v6`, `@v8`).
These resolve to different code if the publisher updates the tag.

**Highest-risk workflows and their secrets:**
- `release.yml` → has `NPM_TOKEN` → compromise = backdoored npm package pushed to all users
- `qa-deploy.yml` → has `DOKPLOY_API_KEY`, `DOKPLOY_URL` → compromise = malicious deploy

**Unpinned actions found:**
```
actions/checkout@v4, @v6
actions/setup-node@v6
actions/github-script@v7, @v8
docker/build-push-action@v6
docker/login-action@v3
docker/setup-buildx-action@v3
docker/setup-qemu-action@v3
```

---

## The Fix

**Step 1 — Resolve current SHAs** for the actions in the two high-priority workflows:

```bash
for action in \
  "actions/checkout" \
  "actions/setup-node" \
  "actions/github-script" \
  "docker/build-push-action" \
  "docker/login-action" \
  "docker/setup-buildx-action" \
  "docker/setup-qemu-action"; do

  # Get tag used in release.yml
  TAG=$(grep -h "uses:.*$action@" .github/workflows/release.yml .github/workflows/qa-deploy.yml 2>/dev/null | \
    grep -oP "@v[0-9]+" | sort -u | head -1)
  SHA=$(gh api repos/$action/git/refs/tags/$TAG --jq '.object.sha' 2>/dev/null)
  echo "  $action$TAG → $SHA"
done
```

**Step 2 — Pin in `.github/workflows/release.yml` and `.github/workflows/qa-deploy.yml`:**

```yaml
# Before:
- uses: actions/checkout@v6

# After:
- uses: actions/checkout@<SHA>  # v6.x.x
```

Priority: pin `release.yml` and `qa-deploy.yml` first. `ci.yml` and `snapshot.yml` have no publish credentials — lower priority.

**Step 3 — Add Dependabot to auto-update SHA pins:**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

Dependabot will open PRs with updated SHAs automatically. Review + merge = safe updates.

---

## Existing Coverage to NOT Duplicate

None. Not covered in any existing spec.

---

## Verification

```bash
# After pinning, verify no mutable tags remain in high-priority workflows:
grep "uses:" .github/workflows/release.yml .github/workflows/qa-deploy.yml | \
  grep -P "@v\d+$"
# Expected: no output (all replaced with full SHAs)

# Verify Dependabot config is valid:
gh api repos/<owner>/<repo>/contents/.github/dependabot.yml
# Expected: file exists and parses without errors
```
