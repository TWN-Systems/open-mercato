#!/usr/bin/env bash
# auth.sh — obtain and export an admin session token
# Usage: source poc/auth.sh
# Sets: ADMIN_TOKEN (JWT), ADMIN_COOKIE (raw cookie header)

set -euo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  echo "[!] Set ADMIN_EMAIL and ADMIN_PASSWORD before sourcing auth.sh"
  return 1 2>/dev/null || exit 1
fi

echo "[*] Logging in as $ADMIN_EMAIL ..."

RESPONSE=$(curl -s -c /tmp/om_cookies.txt -b /tmp/om_cookies.txt \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "[!] Login failed: HTTP $HTTP_CODE"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  return 1 2>/dev/null || exit 1
fi

# Extract token from cookie jar
ADMIN_TOKEN=$(grep "auth_token" /tmp/om_cookies.txt | awk '{print $7}' | head -1)
ADMIN_COOKIE="auth_token=$ADMIN_TOKEN"

export ADMIN_TOKEN
export ADMIN_COOKIE

echo "[+] Authenticated. Token: ${ADMIN_TOKEN:0:20}..."
echo "[+] Exported: ADMIN_TOKEN, ADMIN_COOKIE"
echo ""
echo "# Verify: check who you are"
curl -s "$BASE_URL/api/auth/profile" \
  -H "Cookie: $ADMIN_COOKIE" | python3 -m json.tool 2>/dev/null | head -20
