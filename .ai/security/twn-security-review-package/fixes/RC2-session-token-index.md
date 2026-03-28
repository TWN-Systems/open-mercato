# Fix Plan: RC2 — Session Token Unindexed + Chat Flood

**Severity:** Medium
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Partial — no rate limit on /api/chat (404 in test env); @Index absence confirmed in entity source
**Effort:** ~30 min (index) + ~30 min (rate limit, extends SPEC-030a)
**Spec reference:** SPEC-061 RC2

---

## The Problem

Two components combine into one degradation path:

**Component 1 — Missing database index:**
```typescript
// packages/core/src/modules/api_keys/data/entities.ts
// sessionToken has no @Index or @Unique annotation
@Property({ nullable: true })
sessionToken?: string   // ← full table scan on every lookup
```

Every MCP tool call calls `em.findOne(ApiKey, { sessionToken, deletedAt: null })`.
Without an index, this is `O(n)` against the entire `api_keys` table.

**Component 2 — No rate limit on POST /api/chat:**
Each request without a `sessionId` creates a new `api_keys` row.
No rate limit → unbounded table growth → progressively slower session lookups.

Combined: one user with `ai_assistant.view` can degrade auth for all users.

---

## Fix Part 1 — Add Database Index

**File:** `packages/core/src/modules/api_keys/data/entities.ts`

```typescript
import { Entity, Index, Property, Unique } from '@mikro-orm/core'

@Index({ properties: ['sessionToken'] })   // ← ADD THIS
@Entity({ tableName: 'api_keys' })
export class ApiKey {
  // ...
  @Property({ nullable: true })
  sessionToken?: string
```

Then regenerate the migration:
```bash
yarn db:generate   # generates an ADD INDEX migration
yarn db:migrate    # applies it
```

This is O(1) for the new index. On a table with millions of rows, impact is zero at runtime.

---

## Fix Part 2 — Rate Limit POST /api/chat

**File:** `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts`

The rate limiting infrastructure (SPEC-030a) is already built. This is an extension of it, not a new implementation.

```typescript
// Add to the route metadata
export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['ai_assistant.view'],
    rateLimit: {                    // ← ADD — uses existing SPEC-030a infrastructure
      points: 30,                   // 30 messages
      duration: 60,                 // per 60 seconds
      keyPrefix: 'ai_chat',
    },
  },
}
```

Check how other rate-limited routes declare this (e.g., `auth/login`) and match the pattern. SPEC-030a already provides the dispatcher-level enforcement — this is a metadata declaration only.

---

## Fix Part 3 — Session Token Cleanup (optional but recommended)

Session tokens have a 2-hour TTL but are never cleaned up. Add a scheduled job or a delete-on-expire query to `findApiKeyBySessionToken()`:

```typescript
// apiKeyService.ts — in findApiKeyBySessionToken()
// After the lookup, if expired, hard-delete (not just skip):
if (record && record.expiresAt && record.expiresAt < new Date()) {
  await em.removeAndFlush(record)
  return null
}
```

This keeps the table bounded without needing a separate cleanup job.

---

## Existing Coverage to NOT Duplicate

- **SPEC-030a** — rate limiting foundation, already implemented. This fix EXTENDS it with a new metadata declaration. Do not re-implement the rate limiter.
- No other spec covers the `@Index` on `sessionToken`.

---

## Verification

```bash
# Verify index was created
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'api_keys' AND indexname LIKE '%session%';
-- Must return a row

# Verify rate limit
for i in $(seq 1 35); do
  HTTP=$(curl -s -X POST /api/chat \
    -H "Cookie: auth_token=<token>" \
    -d '{"messages":[{"role":"user","content":"ping"}]}' \
    -o /dev/null -w "%{http_code}")
  echo "Request $i: $HTTP"
done
# Requests 31-35 should return 429

# Verify table scan eliminated
EXPLAIN ANALYZE SELECT * FROM api_keys WHERE session_token = 'sess_abc123...' AND deleted_at IS NULL;
-- Must show "Index Scan" not "Seq Scan"
```
