# Fix Plan: A3 / A5 / A6 — Unbounded Queries and Missing Pagination

**Severity:** Medium (A3), Low (A5, A6)
**Status:** Not in any existing spec or roadmap
**Confirmed live:** A3 — limit=999999 accepted; A6 — raw array response confirmed
**Effort:** ~30 min total (trivial one-liners)
**Spec reference:** SPEC-061 A3/A5/A6

---

## A3 — Workflow Instances List: No Max on `limit` Parameter

**Confirmed live:** `GET /api/workflows/instances?limit=999999` accepted, `limit:999999` echoed back.

**File:** `packages/core/src/modules/workflows/api/instances/route.ts:59`

```typescript
// Current (vulnerable):
const limit = parseInt(searchParams.get('limit') || '50')

// Fixed:
const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50'), 1), 100)
```

Note: CRUD routes use `makeCrudRoute` which already enforces this via `factory.ts:1168`. This route bypasses the factory with a raw ORM query — hence the missing cap.

---

## A5 — Attachment Transfer: Unbounded ID Array

**File:** `packages/core/src/modules/attachments/api/transfer/route.ts:16`

```typescript
// Current:
attachmentIds: z.array(z.string().uuid()).min(1)

// Fixed:
attachmentIds: z.array(z.string().uuid()).min(1).max(1000)
```

One line change. The handler loops over every ID synchronously — 100,000 IDs would block the event loop for an extended period.

---

## A6 — Attachment Library GET: No Pagination

**File:** `packages/core/src/modules/attachments/api/route.ts:174`

```typescript
// Current (no pagination):
const items = await em.find(Attachment, filter, { orderBy: { createdAt: 'desc' } })
return NextResponse.json({ items })

// Fixed:
const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1)
const pageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50'), 1), 100)
const offset = (page - 1) * pageSize

const [items, total] = await em.findAndCount(Attachment, filter, {
  orderBy: { createdAt: 'desc' } as any,
  limit: pageSize,
  offset,
})

return NextResponse.json({
  items,
  total,
  page,
  pageSize,
  totalPages: Math.ceil(total / pageSize),
})
```

This matches the response shape of every other list endpoint in the codebase.

---

## Existing Coverage to NOT Duplicate

None. These are not covered in any existing spec.

The `makeCrudRoute` factory already enforces these patterns for all factory-based routes. These three routes bypass the factory — they need manual enforcement.

---

## Verification

```bash
# A3: limit capped
curl "/api/workflows/instances?limit=999999" -H "Cookie: ..."
# Response: pagination.limit should be 100, not 999999

# A5: transfer rejects >1000 IDs
curl -X POST /api/attachments/transfer \
  -d '{"attachmentIds":["id1","id2",...1001 ids...],"entityId":"...","recordId":"..."}'
# Expected: 400 validation error

# A6: attachment list paginated
curl "/api/attachments?entityId=customers:person&recordId=<uuid>&pageSize=10"
# Expected: { items: [...], total: N, page: 1, pageSize: 10, totalPages: M }
```
