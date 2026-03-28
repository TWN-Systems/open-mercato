# Fix Plan: F02 — Integration Credentials Returned in Plaintext

**Severity:** Medium (design issue, low urgency in self-hosted single-tenant)
**Status:** SPEC-061 H3 covers this
**Confirmed live:** Not fully testable — no integrations configured in test env
**Effort:** ~2 hours
**Spec reference:** SPEC-061 H3

---

## The Problem

`packages/core/src/modules/integrations/api/[id]/credentials/route.ts:61`

```typescript
credentials: values ?? {}   // returns sk_live_..., whsec_..., OAuth tokens in full
```

The admin who configured Stripe already knows their key. The concern is secondary exposure: DevTools network tab, proxy logs, screen sharing, browser history.

In self-hosted single-tenant context: low urgency. Before SaaS launch: required.

---

## Phase 1 Fix — Mask Values in GET Response

**File:** `packages/core/src/modules/integrations/api/[id]/credentials/route.ts`

```typescript
// Add masking helpers
function maskCredentialValue(value: string): string {
  if (typeof value !== 'string' || value.length < 8) return '••••••••'
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`
}

function maskCredentials(
  values: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === 'string' ? maskCredentialValue(v) : v,
    ])
  )
}

// Replace line 61:
// Before:
credentials: values ?? {},

// After:
credentials: maskCredentials(values ?? {}),
```

**Update PUT handler** to skip fields that contain a mask placeholder:
```typescript
// In the PUT handler, before saving:
const MASK_PATTERN = /^.{4}••••••••.{4}$/
const filteredCredentials = Object.fromEntries(
  Object.entries(parsed.data.credentials ?? {}).filter(
    ([, v]) => typeof v !== 'string' || !MASK_PATTERN.test(v)
  )
)
// Only save filteredCredentials — mask placeholders are "keep existing"
```

---

## Phase 2 Fix (pre-SaaS) — Write-Only Fields

Replace the masked GET with `isConfigured: boolean` per field. The form shows "API key is configured. Enter a new value to replace it." No value round-trips to the browser ever.

This is a more significant UI change — leave for Phase 2.

---

## Existing Coverage to NOT Duplicate

- SPEC-061 H3 already specifies both phases — do not create a parallel spec
- The integration credential storage (encrypted at rest) is handled by existing `integrationCredentialsService` — do not change the storage layer

---

## Verification

```bash
# After fix: GET credentials should return masked values
curl /api/integrations/stripe/credentials -H "Cookie: auth_token=<token>"
# Expected:
# { "credentials": { "api_key": "sk_l••••••••...ive4", "webhook_secret": "whse••••••••ret4" } }

# After fix: PUT with masked value should keep existing (not overwrite with mask string)
curl -X PUT /api/integrations/stripe/credentials \
  -d '{"credentials":{"api_key":"sk_l••••••••...ive4"}}' -H "Cookie: ..."
# Expected: existing Stripe key unchanged in DB
```
