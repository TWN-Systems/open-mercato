# Fix Plan: A1 — File Upload Memory Exhaustion

**Severity:** High
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Yes — 20MB upload accepted with HTTP 200 (full file buffered in RAM)
**Effort:** 15 min
**Spec reference:** SPEC-061 A1

---

## The Problem

`packages/core/src/modules/attachments/api/route.ts:263`

```typescript
const buf = Buffer.from(await file.arrayBuffer())  // entire file loaded into RAM first
```

No global size check before this call. A 1GB upload allocates 1GB of Node.js heap.
Concurrent large uploads from multiple users can exhaust available memory and OOM-kill the process.

**Confirmed:** 20MB binary accepted, HTTP 200, no rejection.

There IS a per-field limit (`maxAttachmentSizeMb` on custom field config) but it's checked AFTER `arrayBuffer()` is already called — too late to prevent the allocation.

---

## The Fix

**File:** `packages/core/src/modules/attachments/api/route.ts`

Check `Content-Length` before reading the body. Add a global configurable max that rejects before any memory allocation:

```typescript
// Add near the top of the POST handler, before req.formData()
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? '500') * 1024 * 1024
const contentLength = Number(req.headers.get('content-length') ?? 0)

if (contentLength > MAX_UPLOAD_BYTES) {
  return NextResponse.json(
    { error: `File too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` },
    { status: 413 }
  )
}
```

Also move the existing per-field check BEFORE `arrayBuffer()`:

```typescript
// Current order (bad — allocates before checking):
const buf = Buffer.from(await file.arrayBuffer())   // line 263
if (cfg.maxAttachmentSizeMb ...) { check size }    // line 267

// Fixed order:
const contentLength = file.size  // File object has .size before reading
if (cfg.maxAttachmentSizeMb && contentLength > cfg.maxAttachmentSizeMb * 1024 * 1024) {
  return NextResponse.json({ error: `File exceeds ${cfg.maxAttachmentSizeMb}MB limit` }, { status: 400 })
}
const buf = Buffer.from(await file.arrayBuffer())   // only allocate after size check
```

**Also add to `.env.example`:**
```env
# Global maximum file upload size in MB (default: 500MB)
MAX_UPLOAD_SIZE_MB=500
```

---

## Existing Coverage to NOT Duplicate

None. Not covered anywhere.

---

## Verification

```bash
# Create a 600MB file and attempt upload
dd if=/dev/zero of=/tmp/large_upload.bin bs=1M count=600 2>/dev/null
curl -s -X POST /api/attachments \
  -H "Cookie: auth_token=<token>" \
  -F "file=@/tmp/large_upload.bin" \
  -F "entityId=customers:person" \
  -F "recordId=<uuid>" \
  -w "\nHTTP:%{http_code}"

# Expected (after fix):
# HTTP 413 — before any memory allocation
# Process memory should not spike

# Verify 20MB still works (under limit):
dd if=/dev/zero of=/tmp/small_upload.bin bs=1M count=20 2>/dev/null
curl -s -X POST /api/attachments ... /tmp/small_upload.bin
# Expected: HTTP 200 (under MAX_UPLOAD_SIZE_MB limit)
```
