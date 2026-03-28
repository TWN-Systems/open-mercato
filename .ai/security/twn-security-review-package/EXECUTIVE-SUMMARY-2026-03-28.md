# Security Assessment — Executive Summary
## Open Mercato v0.4.8 / v0.4.9

**Assessment period:** 2026-03-26 to 2026-03-28
**Assessor:** Independent security review
**Scope:** Web application, AI assistant surface, workflow engine, CI/CD pipeline, container configuration
**Test environment:** Self-hosted Docker, isolated lab network — no production systems accessed

---

## Overview

This assessment identified **two critical vulnerabilities** — one introduced in the latest upstream release — alongside six high/medium findings and an active supply chain risk that warrants elevated priority due to current threat actor activity.

The most severe finding allows any admin user to extract all application secrets (database credentials, JWT signing key, encryption keys) through the web interface in under 60 seconds, with no server access required. A second critical finding allows an admin to reach internal network services including the Meilisearch search index and, on cloud deployments, cloud provider metadata endpoints carrying IAM credentials.

The platform's core security model — multi-tenant data isolation, staff/customer separation, RBAC enforcement, PII encryption — is well-designed and consistently implemented. The critical findings are isolated to two specific surfaces: the AI Code Mode sandbox (v0.4.9 only) and the workflow webhook activity.

**All critical and high findings have complete fix plans.** The two critical issues each require under two hours of engineering time to resolve.

---

## Finding Landscape

```mermaid
quadrantChart
    title Risk vs Remediation Effort
    x-axis Low Effort --> High Effort
    y-axis Low Risk --> High Risk
    quadrant-1 Fix First
    quadrant-2 Plan Carefully
    quadrant-3 Nice to Have
    quadrant-4 Quick Wins

    NEW-01 VM Sandbox RCE: [0.15, 0.97]
    F01 SSRF Webhook: [0.12, 0.93]
    NEW-02 Chown Escalation: [0.05, 0.72]
    A1 Upload OOM: [0.10, 0.68]
    F08 CI Supply Chain: [0.22, 0.78]
    RC1 Quote TOCTOU: [0.30, 0.55]
    RC2 Session Index: [0.25, 0.45]
    F03 Security Headers: [0.10, 0.42]
    F17 Meilisearch Port: [0.05, 0.50]
    F02 Credentials Mask: [0.40, 0.35]
    A3-A6 Pagination: [0.18, 0.20]
    A7 SSE Limit: [0.35, 0.28]
    F12 Password Length: [0.05, 0.15]
    F08 Dependabot: [0.20, 0.30]
```

---

## Severity Summary

| ID | Finding | Severity | CVSS | Auth Required | Status |
|----|---------|----------|------|---------------|--------|
| NEW-01 | VM Sandbox Escape — RCE | **Critical** | 9.9 | `ai_assistant.view` (admin) | v0.4.9 only |
| F01 | SSRF via CALL_WEBHOOK | **Critical** | 8.6 | Admin role | All versions |
| NEW-02 | Container Privilege Escalation | **High** | Post-RCE | Code execution | All versions |
| A1 | File Upload Memory Exhaustion | **High** | 7.5 | Upload permission | All versions |
| F08 | GitHub Actions Unpinned Tags | **High** | Supply chain | CI access | All versions |
| RC1 | Quote Acceptance Race Condition | **Medium** | 6.5 | None (email token) | All versions |
| RC2 | Session Token Unindexed + Chat Flood | **Medium** | 5.3 | `ai_assistant.view` | All versions |
| F03 | Missing HTTP Security Headers | **Medium** | 5.1 | None | All versions |
| F17 | Meilisearch Network Exposure | **Medium** | 5.0 | Network access | All versions |
| A7 | SSE No Per-User Connection Limit | **Medium** | 4.8 | Auth | All versions |
| F02 | Integration Credentials in Plaintext | **Medium** | 4.3 | Admin | All versions |
| A3/A5/A6 | Unbounded Pagination | **Low** | 3.1 | Admin | All versions |
| F12 | Default Password Minimum 6 Chars | **Low** | 2.0 | None | All versions |

---

## Critical Attack Chains

### Chain A — Full Compromise via AI Code Mode (External, No Machine Access)

This chain requires only an admin account and network access to the web interface. No SSH, no server credentials, no tooling beyond a browser.

```mermaid
flowchart TD
    A([Attacker: network access\nAdmin account]) --> B

    B["Step 1: Authenticate\nPOST /api/auth/login\n→ JWT token, 8h TTL"]

    B --> C["Step 2: Open AI Code Mode\nCmd+K → Code tab\n(standard admin UI in v0.4.9)"]

    C --> D["Step 3: Submit vm escape payload\nPromise.resolve().constructor.constructor\n('return process.env')()"]

    D --> E{{"HTTP Response Contains\nDATABASE_URL\nJWT_SECRET\nENCRYPTION_KEY\nSTRIPE_SECRET_KEY\nANTHROPIC_API_KEY\n…all env vars"}}

    E --> F["Step 4: Forge Superadmin JWT\nOffline Python + stolen JWT_SECRET\n~5 seconds, no server contact"]

    F --> G["Step 5: API access as superadmin\nall 405+ endpoints, all tenants\ncryptographically valid token"]

    E --> H["Step 6: Direct database access\npsql with stolen DATABASE_URL\nbypasses application entirely"]

    E --> I["Step 7: Decrypt all PII\nstolen ENCRYPTION_KEY\ncustomer emails, contacts, financials"]

    G --> J[["Full tenant data exfiltration\nacross all organizations"]]
    H --> J
    I --> J

    style A fill:#ff6b6b,color:#fff
    style E fill:#ff6b6b,color:#fff
    style J fill:#c0392b,color:#fff
    style D fill:#e74c3c,color:#fff
```

**Root cause:** `node:vm` is not a security boundary. Node.js documentation explicitly states this. The `Promise` injected into the sandbox retains its outer-context prototype chain, reaching the outer `Function` constructor and from there the full Node.js runtime with all native modules. This is not a configuration issue — there is no blocklist or context restriction that closes it. Any injected outer-runtime object (`Promise`, `Object`, `Array`) preserves its prototype link to `Function`.

**Affected:** v0.4.9 only. Not present in v0.4.8 (current local version).

**Fix:** Replace `node:vm` with `isolated-vm` (V8 Isolates) or remove code execution entirely — the AI agent only needs `api.request()`.

`isolated-vm` uses V8 Isolates — a completely separate V8 heap per execution context. The escape vector is structurally closed: the `Promise` inside an Isolate was created in a genuinely different V8 context, so there is no outer `Function` constructor to reach. Works in Alpine with no kernel capabilities required, as an npm dependency.


---

### Chain B — SSRF → Internal Network + Cloud Metadata

```mermaid
flowchart TD
    A([Admin user]) --> B["Create workflow definition\nCALL_WEBHOOK activity\nno URL validation"]

    B --> C{Deployment type?}

    C -->|Docker self-hosted| D["Target: http://172.18.0.2:7700\nMeilisearch on Docker network"]
    C -->|AWS / GCP / Azure| E["Target: http://169.254.169.254\nCloud metadata service"]

    D --> F["Workflow executes\nApp container fetches internal URL\nResponse stored in workflow context"]
    E --> G["IAM credentials returned\nAccess keys, secret keys\nSession tokens"]

    F --> H{Meilisearch master key\nobtained? e.g. via Chain A}
    H -->|Yes| I[["Dump all search indexes\nCross-tenant data\nAll tenants, all entities"]]
    H -->|No| J["Enumerate indexes\nProbe health/version\nBrute-force key offline"]

    G --> K[["AWS: S3 buckets, RDS snapshots\nSecrets Manager values\nAll resources in IAM role scope"]]

    style A fill:#e67e22,color:#fff
    style I fill:#c0392b,color:#fff
    style K fill:#c0392b,color:#fff
```

**Confirmed live:** Meilisearch access log shows `method=GET host="172.18.0.2:7700" user_agent=node status_code=200` from the app container after workflow execution.

**Adjacent context:** `CALL_API` in the same file (line 821) has SSRF prevention with explicit comments. `CALL_WEBHOOK` was added without the equivalent protection.

**Fix:** Add `validateWebhookUrl()` before `fetch()` in `executeCallWebhook()`. 30 minutes of engineering time.

---

### Chain C — Quote Race Condition → Duplicate Orders

```mermaid
sequenceDiagram
    participant C as Customer (email token)
    participant T1 as Request Thread 1
    participant T2 as Request Thread 2
    participant DB as Database

    C->>T1: POST /api/sales/quotes/accept {token}
    C->>T2: POST /api/sales/quotes/accept {token}

    T1->>DB: findOne(Quote, {token}) → status:'sent' ✓
    T2->>DB: findOne(Quote, {token}) → status:'sent' ✓

    Note over T1,T2: Both pass status check simultaneously
    Note over T1,T2: No transaction, no SELECT FOR UPDATE

    T1->>DB: UPDATE quote status → 'confirmed'
    T2->>DB: UPDATE quote status → 'confirmed'

    T1->>DB: INSERT sales_order (id = quote_uuid)
    T2->>DB: INSERT sales_order (id = quote_uuid)

    DB-->>T1: OK
    DB-->>T2: UniqueConstraintViolation ← accidental guard

    Note over DB: Currently stopped by accident<br/>Any future change to order ID generation<br/>produces duplicate orders
```

**Auth required:** None — exploitable by any customer who received an acceptance email link.

---

### Chain D — Container Privilege Escalation (Post–Chain A)

```mermaid
flowchart LR
    A["RCE as omuser\nvia Chain A"] --> B

    B["Dockerfile grants:\nomuser ALL=(root)\nNOPASSWD: /bin/chown"]

    B --> C["sudo /bin/chown omuser /etc/sudoers\n(passwordless, per sudoers)"]

    C --> D["echo 'omuser ALL=(ALL)\nNOPASSWD: ALL' >> /etc/sudoers"]

    D --> E["sudo su -\n→ uid=0(root)"]

    E --> F["Read all secrets\nmodify app code\naccess mounted volumes"]

    F --> G{Host escape?}
    G -->|No docker socket| H["Blocked\nNo CAP_SYS_ADMIN\nNo privileged mode"]
    G -->|Container root| F

    style A fill:#e74c3c,color:#fff
    style E fill:#e74c3c,color:#fff
    style H fill:#27ae60,color:#fff
```

---

## Supply Chain Risk — GitHub Actions (Elevated Priority)

```mermaid
flowchart TD
    A["Team PCP and affiliates\nactively targeting\nnpm-publishing CI pipelines"] --> B

    B["Technique: compromise\nGitHub Action publisher account\nrotate mutable @v tag to malicious SHA"]

    B --> C{release.yml uses\nactions/checkout@v6\nactions/setup-node@v6\ndocker/build-push-action@v6\n+ 6 more mutable tags}

    C -->|Tag rotated by attacker| D["Malicious code executes\nin release CI context"]

    D --> E{{"Secrets in scope:\nNPM_TOKEN\nGITHUB_TOKEN"}}

    E --> F["Publish backdoored package\n@open-mercato/core vX.Y.Z\nto npm registry"]

    F --> G[["All downstream users\ncreate-mercato-app installs\npull backdoored dependency"]]

    style A fill:#8e44ad,color:#fff
    style G fill:#c0392b,color:#fff
    style E fill:#e74c3c,color:#fff
```

**Severity raised to High/P1** based on current threat actor activity. This is no longer a theoretical risk — Team PCP has used this exact technique against npm-publishing workflows. The fix is pinning all actions to full commit SHAs and adding Dependabot for automated SHA updates.

---

## Meilisearch Exposure — Impact Depth

Meilisearch holds a single shared search index covering all tenants. Tenant isolation is enforced at the application layer only; the index itself has no per-tenant access control. If the master key is obtained (via env dump from Chain A, or via credential leak/brute-force), the entire search corpus is readable cross-tenant with a single API call.

```mermaid
flowchart LR
    subgraph External
        ATK([Attacker])
    end

    subgraph "Docker Network (172.18.x.x)"
        APP["App Container\n:3000"]
        MEILI["Meilisearch\n:7700"]
        PG["PostgreSQL\n:5432"]
        REDIS["Redis\n:6379"]
    end

    subgraph "What Meilisearch Indexes"
        IDX1["customers_people\nnames, emails, companies"]
        IDX2["sales_orders\norder numbers, amounts"]
        IDX3["catalog_products\nproducts, SKUs, pricing"]
        IDX4["…all searchable entities\nacross all tenants"]
    end

    ATK -->|"Port 7700 open on network\n10.0.63.14:7700 CONFIRMED"| MEILI
    ATK -->|"SSRF via CALL_WEBHOOK\nF01 CONFIRMED"| APP
    APP -->|"Internal Docker network\nno firewall"| MEILI
    APP --> PG
    APP --> REDIS

    MEILI --> IDX1
    MEILI --> IDX2
    MEILI --> IDX3
    MEILI --> IDX4

    style ATK fill:#e74c3c,color:#fff
    style MEILI fill:#e67e22,color:#fff
```

**Current state:** Port 7700 is network-accessible; default key was rejected (custom key set — good). Risk is medium today, upgrades to critical on any credential leak.

**Fix:** `ports: ["127.0.0.1:7700:7700"]` in docker-compose. Five minutes.

---

## Authentication Architecture

```mermaid
flowchart TD
    subgraph "Two Isolated Auth Realms"
        subgraph "Staff Realm"
            SL["POST /api/auth/login\nform-urlencoded, rate-limited 5/min"] --> SJ["JWT {type: 'staff'\nsub, tenantId, orgId\nroles[], exp: 8h}"]
            SJ --> SC["httpOnly cookie\nauth_token\nSameSite: Lax"]
            SC --> SA["getAuthFromRequest()\nrejects type='customer'"]
            SA --> SR["Route dispatcher\nrequireAuth\nrequireRoles\nrequireFeatures"]
        end

        subgraph "Customer Portal Realm"
            CL["POST /api/portal/auth/login\nrate-limited"] --> CJ["JWT {type: 'customer'\nsub, customerEntityId\nportalRoles[], exp: 8h}"]
            CJ --> CC["httpOnly cookie\ncustomer_auth_token"]
            CC --> CA["getCustomerAuthFromRequest()\nrejects type≠'customer'"]
            CA --> CR["Portal route dispatcher\nrequireCustomerAuth\nrequireCustomerFeatures"]
        end
    end

    subgraph "Verified Blocked"
        B1["Customer JWT → staff endpoint: 401 ✓"]
        B2["Staff JWT → portal endpoint: 401 ✓"]
        B3["isSuperAdmin via API: no write path ✓"]
        B4["Role self-assignment: blocked ✓"]
    end
```

---

## Platform Security Strengths

These controls were verified and found effective. They are worth preserving as the platform evolves.

```mermaid
mindmap
  root((Security Strengths))
    Multi-tenant isolation
      Factory-enforced tenant scoping
      76 routes audited, zero cross-tenant leaks
      findWithDecryption pattern
    Auth model
      Two completely separate realms
      httpOnly cookies, SameSite Lax
      Rate limiting on all auth endpoints
      Non-enumerable reset flows
      Single-use magic links with usedAt enforcement
    Access control
      Feature-based RBAC not role hierarchy
      Per-request ACL load, no stale cache
      isSuperAdmin has no API write path
      Declarative requireFeatures on all routes
    Data protection
      AES-GCM PII encryption at field level
      Tenant-scoped derived encryption keys
      Vault integration supported
      Soft deletes with audit trail
    AI access model
      Staff-only, no customer AI access
      AI inherits user's session permissions
      Cannot exceed caller's ACL
```

---

## Remediation Roadmap

```mermaid
gantt
    title Remediation Priority Sequence
    dateFormat  YYYY-MM-DD
    axisFormat  %d %b

    section P0 Immediate
    NEW-01 vm sandbox escape        :crit, p0a, 2026-03-29, 1d
    F01 SSRF CALL_WEBHOOK           :crit, p0b, 2026-03-29, 1d

    section P1 This Sprint
    NEW-02 Remove chown sudoers     :p1a, 2026-03-30, 1d
    A1 Content-Length check         :p1b, 2026-03-30, 1d
    F08 Pin GitHub Actions SHAs     :crit, p1c, 2026-03-30, 1d
    RC1 Quote TOCTOU fix            :p1d, 2026-03-31, 1d
    RC2 sessionToken index          :p1e, 2026-03-31, 1d
    F03 HTTP security headers       :p1f, 2026-03-31, 1d

    section P2 Next Sprint
    F17 Meilisearch localhost bind  :p2a, 2026-04-07, 1d
    F02 Integration credentials     :p2b, 2026-04-07, 3d
    F08 Add Dependabot              :p2c, 2026-04-08, 1d

    section P3 Backlog
    A3 A5 A6 Pagination caps        :p3a, 2026-04-14, 2d
    A7 SSE connection limit         :p3b, 2026-04-14, 2d
    A8 Rate limits                  :p3c, 2026-04-16, 2d
    F12 Password minimum length     :p3d, 2026-04-17, 1d
```

---

## Effort vs. Impact Summary

| Priority | Finding | Fix Effort | Impact If Unresolved |
|----------|---------|------------|---------------------|
| **P0** | NEW-01: VM sandbox RCE | Replace `node:vm` (~2h) | All secrets exfiltrated via browser; full tenant compromise |
| **P0** | F01: SSRF CALL_WEBHOOK | 30 min | Internal network reachable; AWS IAM credentials on cloud |
| **P1** | NEW-02: chown escalation | 2 min (remove 1 line) | Post-RCE container root; complete persistence |
| **P1** | A1: Upload OOM | 15 min | Any authed user OOM-kills server, all tenants offline |
| **P1** | F08: CI supply chain | 30 min | Backdoored npm package to all `create-mercato-app` users |
| **P1** | RC1: Quote TOCTOU | 1h | Duplicate orders via race; accidental guard only |
| **P1** | RC2: Session index | 30 min | Auth degradation under load; table scan every tool call |
| **P1** | F03: Security headers | 10 min | Clickjacking, MIME sniffing, referrer leakage |
| **P2** | F17: Meilisearch bind | 5 min | Cross-tenant search data on key compromise |
| **P2** | F02: Credentials mask | 2h | Integration secrets in browser DevTools / proxy logs |

---

## What Was Not Vulnerable

The following areas were audited and confirmed secure. Documenting these explicitly to distinguish the scope of concern.

| Surface | Tested | Result |
|---------|--------|--------|
| SQL injection (Knex whereRaw) | All parameterised bindings audited | No interpolation of user input |
| XSS via React | All dangerouslySetInnerHTML usages | react-markdown escapes HTML by default |
| Path traversal in file storage | resolveAttachmentAbsolutePath | Strips `../`, sanitises to safe chars |
| Command injection (execFile usage) | Arguments as array | No shell string construction |
| IDOR / cross-tenant data | 76 routes across customers, sales, catalog | All correctly scope tenantId + organizationId |
| Customer → staff realm escalation | type:'customer' JWT on staff endpoint | 401 — hard rejection at auth utility |
| Employee → admin privilege escalation | No write path to isSuperAdmin | Flag is DB-only, no API surface |
| Magic link token replay | usedAt enforcement in customerTokenService | Single-use confirmed |
| Account enumeration | Password reset, login error messages | Always returns generic response |

---

## Architectural Note — BYOAI Model

The VM sandbox finding (NEW-01) is not a bug in the sandbox configuration — it is a consequence of `node:vm` being fundamentally unsuitable for arbitrary code execution. Any sandbox built on it can be escaped via the `Promise` constructor chain on Node.js 22.

A more durable solution than replacing the sandbox is removing the need for one:

```mermaid
flowchart TB
    subgraph CUR["Current — v0.4.9"]
        B["Browser / Cmd+K"] --> API["/api/chat"] --> OC["OpenCode :4096"] --> MCP["MCP Server :3001"] --> APP["Application APIs"]
    end

    subgraph NEW["Proposed — BYOAI"]
        EXT["External AI Client"] --> MCPH["MCP HTTP Server /mcp"] --> APP2["Application APIs"]
    end

    CUR -. "remove sandbox + OpenCode binary" .-> NEW
```

**What this achieves:**
- The vm sandbox vulnerability class is structurally eliminated — no server-side code execution
- OpenCode (a third-party binary) is removed from the trust chain
- Users bring their own AI client (Claude Desktop, any MCP-compatible tool) and any model
- Customer agents become possible: portal-scoped API key → portal MCP surface
- Audit trail improvement: API key identity recorded, not just user identity

The MCP server and API key infrastructure already exist. This is a removal of components, not an addition.

---

## Evidence Index

All raw evidence is in `.ai/security/evidence/`:

| File | Contents |
|------|---------|
| `F01-ssrf-call-webhook.txt` | Workflow execution trace + Meilisearch access log (user_agent=node confirmed) |
| `F03-security-headers.txt` | `curl -sI` output — all 6 headers absent |
| `RC1-quote-toctou.txt` | Concurrent test log + UniqueConstraintViolationException at 15:49:23.037Z / .044Z |
| `A3-workflow-unbounded-limit.txt` | API response with `limit:999999` echoed in pagination envelope |
| `F17-meilisearch-exposure.txt` | Port reachability + key probe results |
| `ATTACK-CHAIN-EXTERNAL.md` | Step-by-step reproduction of Chain A |
| `NEW01-vm-sandbox-escape-CONFIRMED.json` | Machine-readable confirmation record |
| `screenshots/06a-NEW01-ai-code-mode-open.png` | AI Code Mode accessible in admin UI |
| `screenshots/06b-NEW01-escape-payload.png` | Escape payload submitted and executed |

Fix plans with exact file paths, line numbers, and code: `.ai/security/fixes/`
Strategic hardening spec: `.ai/specs/SPEC-061-2026-03-26-security-hardening.md`

---

*Assessment conducted in good faith on an isolated self-hosted test environment. No production systems were accessed. No data was exfiltrated. Findings reported privately before any public disclosure.*
