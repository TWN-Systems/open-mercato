# Fix Plan: A2 / A4 / A8 — Missing Rate Limits on Expensive Endpoints

**Severity:** Medium (A2, A7), Low (A4, A8)
**Status:** SPEC-030a (rate limiting) already implemented — this extends it
**Confirmed live:** A2 — no 429 on /api/chat; A4 — no 429 on workflow creation; A8 — HTTP 200 on repeat reindex
**Effort:** ~1 hour total (metadata declarations only, no new infrastructure)
**Spec reference:** SPEC-061 A2/A4/A8, extends SPEC-030a

---

## IMPORTANT: Do NOT Re-Implement Rate Limiting

SPEC-030a already built the rate limiting infrastructure. The `rateLimitCheck` utility and the dispatcher integration exist. These fixes are **metadata declarations only** — one object per endpoint. Read SPEC-030a before touching this.

---

## A2 — AI Chat Rate Limit

**File:** `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts`

```typescript
export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['ai_assistant.view'],
    rateLimit: {
      points: 30,
      duration: 60,
      keyPrefix: 'ai_chat',
    },
  },
}
```

**Why 30/min:** Generous enough for real use (one message every 2s), tight enough to prevent API cost amplification. Adjust if needed.

---

## A4 — Workflow Instance Creation Rate Limit

**File:** `packages/core/src/modules/workflows/api/instances/route.ts`

```typescript
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['workflows.instances.view'] },
  POST: {
    requireAuth: true,
    requireFeatures: ['workflows.instances.create'],
    rateLimit: {
      points: 100,
      duration: 60,
      keyPrefix: 'workflow_instances',
    },
  },
}
```

**Why 100/min:** Reasonable for automated trigger flows (event-driven). Tighter if needed.

---

## A8 — Search Reindex Cooldown

**File:** `packages/search/src/modules/search/api/reindex/route.ts`

```typescript
export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['search.reindex'],
    rateLimit: {
      points: 3,
      duration: 3600,    // 3 reindex operations per hour per user
      keyPrefix: 'search_reindex',
    },
  },
}
```

**Why 3/hour:** Reindex is expensive (DB read + OpenAI API calls per record). 3/hour is generous; full reindex on large datasets can take minutes.

---

## Existing Coverage to NOT Duplicate

- **SPEC-030a** provides the entire rate limiting foundation — dispatcher-level enforcement, IP + compound key patterns, `rateLimitCheck` utility
- This fix only adds `rateLimit` keys to existing route metadata objects
- Check how `auth/login` declares its rate limit and match the exact same schema

---

## Verification

```bash
# A2: Chat rate limit
for i in $(seq 1 35); do
  HTTP=$(curl -s -X POST /api/chat -H "Cookie: auth_token=<t>" \
    -d '{"messages":[{"role":"user","content":"ping"}]}' -o /dev/null -w "%{http_code}")
  echo "req $i: $HTTP"
done
# Requests 31-35 → 429

# A8: Reindex cooldown
for i in 1 2 3 4; do
  HTTP=$(curl -s -X POST /api/search/reindex -H "Cookie: auth_token=<t>" -o /dev/null -w "%{http_code}")
  echo "reindex $i: $HTTP"
done
# Request 4 → 429
```
