#!/usr/bin/env bash
# F03 — Missing HTTP Security Headers
#
# Finding: No X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy,
# or Permissions-Policy headers in any response.
#
# Expected (secure): All headers present in every response
# Expected (insecure): None of these headers present
#
# CVSS v3: AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N (4.7 Medium)

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/F03-security-headers.txt}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

REQUIRED_HEADERS=(
  "x-frame-options"
  "x-content-type-options"
  "strict-transport-security"
  "referrer-policy"
  "permissions-policy"
  "content-security-policy"
)

{
echo "================================================================"
echo " F03: Missing HTTP Security Headers"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

for path in "/" "/backend" "/api/auth/login"; do
  echo "--- Path: $path ---"
  echo "Command: curl -sI $BASE_URL$path"
  HEADERS=$(curl -sk --max-time 10 -I "$BASE_URL$path" 2>/dev/null)
  echo "$HEADERS"
  echo ""

  echo "Security header presence:"
  PASS=0
  FAIL=0
  for header in "${REQUIRED_HEADERS[@]}"; do
    if echo "$HEADERS" | grep -qi "^${header}:"; then
      VALUE=$(echo "$HEADERS" | grep -i "^${header}:" | head -1 | tr -d '\r')
      echo "  [PRESENT] $VALUE"
      ((PASS++))
    else
      echo "  [MISSING] $header"
      ((FAIL++))
    fi
  done
  echo "  Present: $PASS / ${#REQUIRED_HEADERS[@]}"
  echo ""
done

echo "--- Summary ---"
echo "If all headers are missing, the application is vulnerable to:"
echo "  - Clickjacking (no X-Frame-Options)"
echo "  - MIME sniffing attacks (no X-Content-Type-Options)"
echo "  - HTTP downgrade on first visit (no HSTS)"
echo "  - Referrer leakage to third parties (no Referrer-Policy)"
echo ""
echo "Remediation: Add headers() function to apps/mercato/next.config.ts"
echo "  OR configure Traefik secheaders middleware"
echo "  OR configure Cloudflare Transform Rules"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
