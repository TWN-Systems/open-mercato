# Fix Plan: F01 — SSRF via CALL_WEBHOOK

**Severity:** Critical (SaaS) / Low (trusted self-hosted)
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Yes — Meilisearch at 172.18.0.2:7700 reached via workflow
**Effort:** ~30 min
**Spec reference:** SPEC-061 H2

---

## The Problem

`CALL_WEBHOOK` in `activity-executor.ts` makes a raw `fetch(url)` with zero URL validation.
`CALL_API` in the same file has explicit SSRF prevention (`buildApiUrl()`, line 821).
The developer knew — they labelled it `// SSRF Prevention`. `CALL_WEBHOOK` was added later without it.

**Proven impact on test box:**
- Workflow hit `http://172.18.0.2:7700/health` (Meilisearch Docker internal)
- Response `{"status":"available"}` stored in workflow context
- On cloud: `http://169.254.169.254/latest/meta-data/iam/security-credentials/` returns IAM keys

---

## The Fix

**File:** `packages/core/src/modules/workflows/lib/activity-executor.ts`

Add `validateWebhookUrl()` immediately before the `fetch()` call in `executeCallWebhook()`:

```typescript
// Add this function near buildApiUrl() (line ~821)
function validateWebhookUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`CALL_WEBHOOK: invalid URL "${url}"`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`CALL_WEBHOOK: only HTTP/HTTPS allowed, got "${parsed.protocol}"`)
  }

  // Opt-out for trusted self-hosted internal networks
  if (process.env.WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS === 'true') return

  const privateRanges = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|0\.0\.0\.0)/i
  if (privateRanges.test(parsed.hostname)) {
    throw new Error(
      `CALL_WEBHOOK: URL targets a private/reserved address (${parsed.hostname}). ` +
      `Set WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS=true for trusted self-hosted deployments.`
    )
  }
}

// In executeCallWebhook(), add as first line after the url existence check:
export async function executeCallWebhook(config: any, context: ActivityContext) {
  const { url, method = 'POST', headers = {}, body } = config
  if (!url) throw new Error('CALL_WEBHOOK requires "url" field')

  validateWebhookUrl(url)  // ← ADD THIS LINE

  const response = await fetch(url, { ... })
```

**Also add to `.env.example`:**
```env
# Allow CALL_WEBHOOK to reach private/internal addresses.
# Only for fully self-hosted single-tenant deployments where
# workflow admins are trusted. NEVER set in multi-tenant/SaaS.
WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS=false
```

---

## Existing Coverage to NOT Duplicate

- `CALL_API` already has `buildApiUrl()` with SSRF prevention — copy the same pattern, don't create a new utility
- SPEC-057 (Webhooks Module) covers *inbound* webhook handling — unrelated to this outbound SSRF fix
- SPEC-030a (Rate Limiting) — unrelated

---

## Verification

```bash
# Should succeed (external URL)
POST /api/workflows/instances with CALL_WEBHOOK → https://hooks.slack.com/...
→ Expected: workflow executes normally

# Should fail (private range)
POST /api/workflows/instances with CALL_WEBHOOK → http://127.0.0.1:7700/health
→ Expected: workflow fails with "URL targets a private/reserved address (127.0.0.1)"

# Should succeed with opt-out (self-hosted internal)
WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS=true
POST /api/workflows/instances with CALL_WEBHOOK → http://internal-service/health
→ Expected: workflow executes (env override respected)
```
