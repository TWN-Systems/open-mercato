# Fix Plan: RC1 — Quote Acceptance TOCTOU Race Condition

**Severity:** Medium
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Yes — multiple concurrent INSERTs on same order ID, 7ms apart in logs
**Effort:** ~1 hour
**Spec reference:** SPEC-061 RC1

---

## The Problem

`POST /api/sales/quotes/accept` has no transaction or lock around the check-modify-execute cycle:

```typescript
// quotes/accept/route.ts:41-68 — current (vulnerable)
if ((quote.status ?? null) !== 'sent') { throw 400 }   // CHECK
quote.status = 'confirmed'
await em.flush()                                         // no transaction
await commandBus.execute('sales.quotes.convert_to_order', ...)  // EXECUTE
```

Concurrent requests both read `status='sent'`, both pass, both attempt `convert_to_order`.
Duplicate orders prevented *accidentally* only because order ID = quote ID (same UUID).
Any future change to order ID generation would expose actual duplicate order creation.

**Live evidence:** `UniqueConstraintViolationException` twice at 15:49:23.037Z and .044Z on same INSERT.

---

## The Fix

**File:** `packages/core/src/modules/sales/api/quotes/accept/route.ts`

Wrap the check + status update in a transaction with a pessimistic write lock.
Execute `convert_to_order` **outside** the transaction to avoid holding the lock during the command.

```typescript
import { LockMode } from '@mikro-orm/core'

// Replace the current check+flush block with:
await em.transactional(async (txEm) => {
  // SELECT FOR UPDATE — blocks concurrent reads until this transaction commits
  const lockedQuote = await txEm.findOne(
    SalesQuote,
    { acceptanceToken: token, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE }
  )

  if (!lockedQuote) {
    throw new CrudHttpError(404, { error: translate('api.errors.not_found', 'Quote not found') })
  }

  if ((lockedQuote.status ?? null) !== 'sent') {
    throw new CrudHttpError(400, { error: 'Cannot accept a quote that is not in sent status.' })
  }

  lockedQuote.status = 'confirmed'
  lockedQuote.acceptedAt = new Date()
  await txEm.flush()
})

// convert_to_order runs AFTER the lock is released
await commandBus.execute('sales.quotes.convert_to_order', {
  input: { quoteId: quote.id, ... },
  ctx,
})
```

**Why `convert_to_order` is outside the lock:**
- The command creates an order row — no need to hold the quote lock during that
- Holding a write lock during a slow command increases deadlock risk
- The lock's only job is to serialise the status check + status update

---

## Existing Coverage to NOT Duplicate

- SPEC-018 (`withAtomicFlush`) covers a different issue: silent MikroORM flush drops when a `em.find()` runs between scalar mutations. This is a different bug — RC1 is about concurrent HTTP requests, not single-request flush ordering.
- SPEC-030a (Rate Limiting) — does not fix TOCTOU; rate limiting slows the attack but doesn't prevent it
- No other spec covers this

---

## Verification

```bash
# 1. Create a quote, send it (generates token), read token from DB

# 2. Fire 20 concurrent accepts
TOKEN="<acceptance-token>"
for i in $(seq 1 20); do
  curl -s -X POST /api/sales/quotes/accept \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\"}" &
done; wait

# Expected (after fix):
# - Exactly 1x HTTP 200
# - All others HTTP 400 "Cannot accept a quote that is not in sent status."
# - NO UniqueConstraintViolationException in app logs
# - Exactly 1 order created in DB
SELECT COUNT(*) FROM sales_orders WHERE quote_id = '<quote-id>';
-- Must return 1
```
