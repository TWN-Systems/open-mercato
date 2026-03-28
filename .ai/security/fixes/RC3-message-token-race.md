# Fix Plan: RC3 — Message Token Replay Race Condition

**Severity:** Low-Medium
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Code-only (same pattern as RC1, confirmed by source review)
**Effort:** ~45 min
**Spec reference:** SPEC-061 (RC3 section)

---

## The Problem

`packages/core/src/modules/messages/commands/tokens.ts:28-57`

```typescript
// CHECK
if (accessToken.useCount >= MAX_TOKEN_USE_COUNT) {  // MAX = 25
  throw new Error('This link can no longer be used')
}

// MODIFY (no lock, no transaction)
accessToken.usedAt = new Date()
accessToken.useCount += 1   // ← read-modify-write without SELECT FOR UPDATE
await em.flush()
```

Same TOCTOU pattern as RC1. Two concurrent requests both read `useCount=24`, both pass the check, both increment. Token can be used more than `MAX_TOKEN_USE_COUNT` times.

**Impact:** Message access tokens consumed more times than intended. Lower severity than RC1 because this is information disclosure (reading a message), not financial (duplicate orders).

---

## The Fix

**File:** `packages/core/src/modules/messages/commands/tokens.ts`

Wrap in a transaction with a pessimistic write lock, matching the RC1 fix pattern:

```typescript
import { LockMode } from '@mikro-orm/core'

// Replace the current check+increment block:
await em.transactional(async (txEm) => {
  const lockedToken = await txEm.findOne(
    MessageAccessToken,
    { token: input.token },
    { lockMode: LockMode.PESSIMISTIC_WRITE }  // SELECT FOR UPDATE
  )

  if (!lockedToken) throw new Error('Invalid or expired link')
  if (lockedToken.expiresAt < new Date()) throw new Error('This link has expired')
  if (lockedToken.useCount >= MAX_TOKEN_USE_COUNT) {
    throw new Error('This link can no longer be used')
  }

  lockedToken.usedAt = new Date()
  lockedToken.useCount += 1
  await txEm.flush()

  // return token for use outside transaction
  return lockedToken
})
```

---

## Existing Coverage to NOT Duplicate

- RC1 fix (quote TOCTOU) uses the same pattern — check that fix first and use the same approach for consistency
- No other spec covers this

---

## Verification

```bash
# Create a message with an access token, then fire concurrent redemptions
# Requires messages module to be configured with token-based access

TOKEN="<message-access-token>"
for i in $(seq 1 30); do
  curl -s -X POST /api/messages/token/$TOKEN &
done; wait

# Expected (after fix): useCount never exceeds MAX_TOKEN_USE_COUNT (25)
SELECT use_count FROM message_access_tokens WHERE token = '<token>';
-- Must be <= 25
```
