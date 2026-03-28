# Security Testing

Target: `10.0.63.14`
Date: 2026-03-26

## Structure

```
.ai/security/
├── README.md              — this file, index + setup
├── poc/                   — one script per finding
│   ├── F03-security-headers.sh
│   ├── F17-meilisearch-exposure.sh
│   ├── RC1-quote-toctou.sh
│   ├── RC2-session-token-flood.sh
│   ├── A1-upload-oom.sh
│   ├── F01-ssrf-call-webhook.sh
│   ├── F02-credentials-get.sh
│   ├── CHAIN-omega-service-dos.sh
│   └── CHAIN-delta-meilisearch-exfil.sh
└── evidence/              — captured output per finding
    ├── F17-meilisearch-exposure.txt
    └── ...
```

## Setup

```bash
# Set these before running any PoC
export TARGET="10.0.63.14"
export APP_PORT="3000"                    # adjust if different
export BASE_URL="http://$TARGET:$APP_PORT"

# Credentials — fill in after first login
export ADMIN_EMAIL="admin@example.com"
export ADMIN_PASSWORD="changeme"
export ADMIN_TOKEN=""                     # set after: source poc/auth.sh

# Optional — only needed for specific tests
export QUOTE_TOKEN=""                     # from a real quote acceptance link
export INTEGRATION_ID="stripe"            # for F02
```

## Running Tests

```bash
# 1. Start with no-auth tests (always safe to run)
bash poc/F03-security-headers.sh
bash poc/F17-meilisearch-exposure.sh

# 2. Auth tests — requires ADMIN_TOKEN
source poc/auth.sh          # sets ADMIN_TOKEN
bash poc/F02-credentials-get.sh
bash poc/F01-ssrf-call-webhook.sh

# 3. Race condition tests — use with care on production data
bash poc/RC1-quote-toctou.sh   # requires QUOTE_TOKEN

# 4. Availability tests — run in a test environment, not production
bash poc/A1-upload-oom.sh
bash poc/RC2-session-token-flood.sh
```

## Evidence Format

Each PoC captures to `evidence/<ID>-<finding>.txt` with:
- Timestamp
- Command run
- Raw response
- Pass/Fail verdict
- CVSS-like impact note

## Status

| ID | Finding | Tested | Result | Evidence |
|----|---------|--------|--------|----------|
| F17 | Meilisearch network exposure | ✓ | CONFIRMED | evidence/F17-meilisearch-exposure.txt |
| F03 | Missing security headers | ✗ | Pending (app not up) | — |
| RC1 | Quote TOCTOU | ✗ | Pending | — |
| RC2 | Session token table scan | ✗ | Pending | — |
| A1 | File upload OOM | ✗ | Pending | — |
| F01 | SSRF CALL_WEBHOOK | ✗ | Pending | — |
| F02 | Integration credentials GET | ✗ | Pending | — |
| CHAIN-Omega | DoS chain | ✗ | Pending | — |
| CHAIN-Delta | Meilisearch exfil | ✗ | Pending (key non-default) | — |
