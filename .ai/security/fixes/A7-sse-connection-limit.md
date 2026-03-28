# Fix Plan: A7 — SSE No Per-User Connection Limit

**Severity:** Medium
**Status:** Not in any existing spec or roadmap
**Confirmed live:** 5 concurrent SSE connections from one user — no rejection
**Effort:** ~45 min
**Spec reference:** SPEC-061 A7

---

## The Problem

`packages/events/src/modules/events/api/stream/route.ts`

The global `Set<SseConnection>` tracks all connections but has no per-user cap. One authenticated user can open hundreds of concurrent SSE connections, consuming file descriptors. Node.js has a finite fd pool per process. When exhausted, no new connections (HTTP or SSE) can be established — complete service denial for all users.

---

## The Fix

**File:** `packages/events/src/modules/events/api/stream/route.ts`

```typescript
const MAX_CONNECTIONS_PER_USER = parseInt(process.env.SSE_MAX_CONNECTIONS_PER_USER ?? '5')

// In the SSE handler, before creating the new connection:
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return new Response('Unauthorized', { status: 401 })

  // Count existing connections for this user
  const userConnectionCount = [...connections].filter(
    (c) => c.userId === auth.sub
  ).length

  if (userConnectionCount >= MAX_CONNECTIONS_PER_USER) {
    return new Response('Too many connections', { status: 429 })
  }

  // ... rest of existing SSE setup
  const conn: SseConnection = {
    userId: auth.sub,           // ← add userId to the connection object
    tenantId: auth.tenantId,
    // ... existing fields
  }
  connections.add(conn)
```

**Also add to `.env.example`:**
```env
# Maximum concurrent SSE event stream connections per user (default: 5)
SSE_MAX_CONNECTIONS_PER_USER=5
```

The `SseConnection` type needs `userId` added if not already present:
```typescript
type SseConnection = {
  userId: string          // ← add this
  tenantId: string | null
  // ... existing fields
}
```

---

## Existing Coverage to NOT Duplicate

None. Not covered in any existing spec. The DOM Event Bridge spec (packages/events/AGENTS.md) describes the SSE architecture but has no connection limit requirement.

---

## Verification

```bash
# Open 6 concurrent SSE connections from one user
for i in $(seq 1 6); do
  HTTP=$(curl -s --no-buffer --max-time 5 /api/events/stream \
    -H "Cookie: auth_token=<token>" \
    -H "Accept: text/event-stream" \
    -o /dev/null -w "%{http_code}" &)
  echo "Connection $i: $HTTP"
done

# Expected (after fix):
# Connections 1-5: 200 (established)
# Connection 6: 429 (rejected)

# Verify existing connections still work after rejection:
curl -s /api/auth/profile -H "Cookie: auth_token=<token>"
# Expected: 200 (service healthy)
```
