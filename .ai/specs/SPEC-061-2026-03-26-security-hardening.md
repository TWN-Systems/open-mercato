# SPEC-061 — Security Hardening

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-26 |
| **Related** | `apps/mercato/next.config.ts`, `packages/core/src/modules/workflows/lib/activity-executor.ts`, `packages/core/src/modules/integrations/api/[id]/credentials/route.ts`, `packages/core/src/modules/sales/api/quotes/accept/route.ts`, `packages/core/src/modules/api_keys/data/entities.ts`, `.github/workflows/` |

## TLDR

Full security audit findings across OWASP Top 10, dependency review, MCP/AI surface, availability, race conditions, and injection vectors. Each finding includes confirmed status, deployment context, PoC location, and remediation.

PoC scripts: `.ai/security/poc/`
Evidence: `.ai/security/evidence/`

---

## Finding Index

| ID | Category | Finding | Severity | Exploitable | Auth Required | PoC |
|----|----------|---------|----------|-------------|---------------|-----|
| F01 | Injection | SSRF via `CALL_WEBHOOK` | Critical (SaaS) / Low (self-hosted) | Yes | Admin | `poc/F01-ssrf-call-webhook.sh` |
| F02 | Data Exposure | Integration credentials in GET response | Medium | Yes | Admin | `poc/F02-credentials-get.sh` |
| F03 | Misconfiguration | Missing HTTP security headers | Medium | Yes (clickjacking) | None | `poc/F03-security-headers.sh` |
| F04 | Outdated Deps | `next@16.1.5` CVEs | Not exploitable | No | N/A | — |
| F05 | Misconfiguration | MCP server binds `0.0.0.0` | Low (dev only) | Dev env | Dev machine | — |
| F06 | Data Exposure | Session token in AI system prompt | Low | No (trust boundary) | User | — |
| F07 | Crypto | API key timing attack (dev server) | Negligible | Dev only | Dev machine | — |
| F08 | Supply Chain | GitHub Actions unpinned tags | Medium | Low probability | CI access | — |
| F09 | Supply Chain | Docker base image floating tag | Info | No | N/A | — |
| F10 | Access Control | Business rules no pre-ownership check | Low | Likely safe | Admin | — |
| F11 | Access Control | Offers enrichment without tenant filter | Theoretical | No (data integrity req'd) | None | — |
| F12 | Auth | Default password minimum 6 chars | Low | Mitigated by bcrypt+ratelimit | None | — |
| F13 | Access Control | Bulk delete IDs without pre-check | Low | Worker re-checks | Admin | — |
| F14 | Design | Public quote token — no expiry/audit | Low | Design choice | None | — |
| F15 | Design | `call_api` MCP defers ACL downstream | Info | By design | MCP access | — |
| F16 | Design | `CALL_API` creates admin-level one-time key | Info / Medium (SaaS) | By design | Admin | — |
| F17 | Misconfiguration | Meilisearch port 7700 exposed to network | High (if default key) / Medium | **Confirmed on 10.0.63.14** | None | `poc/F17-meilisearch-exposure.sh` |
| F18 | Deps | `glob@11.1.0` deprecation | Info | No | N/A | — |
| RC1 | Race Condition | Quote acceptance TOCTOU | Medium | Yes (no auth) | None | `poc/RC1-quote-toctou.sh` |
| RC2 | Race Condition | `sessionToken` unindexed + chat flood → auth degradation | Medium | Yes | `ai_assistant.view` | `poc/RC2-session-token-flood.sh` |
| RC3 | Race Condition | Message token replay race | Low | Requires concurrent timing | None (token) | — |
| A1 | Availability | File upload no size limit → OOM | High | Yes | Upload perm | `poc/A1-upload-oom.sh` |
| A2 | Availability | AI chat no rate limit → API cost amplification | Medium | Yes | `ai_assistant.view` | Part of RC2 |
| A3 | Availability | Workflow instances list unbounded (`limit=999999`) | Medium | Yes | `workflows.instances.view` | — |
| A4 | Availability | Workflow instance creation no rate limit | Medium | Yes | Admin | Part of CHAIN-Gamma |
| A5 | Availability | Attachment transfer unbounded array | Low | Yes | Upload perm | — |
| A6 | Availability | Attachment library GET no pagination | Low | Yes | Read perm | — |
| A7 | Availability | SSE no per-user connection limit | Medium | Yes | Any auth | Part of CHAIN-Omega |
| A8 | Availability | Search reindex no cooldown | Low | Yes (admin) | Admin | — |
| S1 | Shell | `markitdown` execFile — safe (array args + sanitised path) | Verified safe | No | — | — |
| S2 | SQL | Raw SQL via Knex — all hardcoded or parameterised | Verified safe | No | — | — |
| P1 | Privilege Esc | Customer JWT → backend API | Blocked | No | — | — |
| P2 | Privilege Esc | Employee → admin escalation | Blocked | No | — | — |

---

## Attack Chains

| Chain | Components | Auth Required | Impact |
|-------|-----------|---------------|--------|
| **Omega** | RC2 + A2 + A7 | `ai_assistant.view` | Full service DoS — fd exhaustion | `poc/CHAIN-omega-service-dos.sh` |
| **Alpha** | RC1 at scale | None | Stock exhaustion / duplicate orders | RC1 PoC repeated |
| **Beta** | A1 concurrent | Upload perm | Process OOM crash → service down | A1 PoC concurrent |
| **Gamma** | A4 + F16 | Admin | DB connection pool exhaustion | — |
| **Delta** | F17 + F01 | Admin + default Meilisearch key | Cross-tenant search dump | F17 + F01 combined |

---

## Confirmed on 10.0.63.14 / 10.0.63.13

### Infrastructure discovered

| Host | Port | Service | Finding |
|------|------|---------|---------|
| `10.0.63.14` | 7700 | Meilisearch | F17 — network accessible, custom key set (not default) |
| `10.0.63.13` | 3000 | Pangolin gateway | Reverse proxy / tunnel control plane |

### F17 — Meilisearch Network Exposure (CONFIRMED)

**Evidence:** `.ai/security/evidence/F17-meilisearch-exposure.txt`

- Port 7700 responds on `10.0.63.14` — publicly accessible on the network
- Default key `meilisearch-dev-key` rejected — operator changed the key (good)
- **Residual risk:** Port should not be network-accessible regardless of key strength; a leaked key or brute-forced weak key exposes all indexed tenant data
- **Status:** Partial — key is custom, but firewall/network isolation missing

### F03 — Missing Security Headers (CONFIRMED)

**Evidence:** Pending (app URL needed — Pangolin gateway found at `.13:3000`, not app)

`10.0.63.13:3000` returns no security headers on any path (`/`, `/backend`, `/api/auth/login`). This is the Pangolin control plane. The Open Mercato app URL must be confirmed separately.

---

## H1 — HTTP Security Headers

### Problem

No `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, or `Permissions-Policy` in any response. Confirmed absent on discovered hosts.

### Per-Deployment Assessment

| Deployment | Headers added by infra? | App-layer fix needed? |
|-----------|------------------------|----------------------|
| D1 Railway | No | Yes |
| D2 Bare Docker | No | Yes |
| D3 Cloudflare Tunnel | Configurable via Transform Rules | Yes (or configure CF) |
| D4 Traefik/Pangolin | Yes if `headers` middleware configured | Optional |
| D5 Standalone | Unknown | Yes |

### Proposed App-Layer Change

```typescript
// apps/mercato/next.config.ts
async headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ]
},
```

**Traefik middleware** (`traefik/dynamic.yml`):
```yaml
http:
  middlewares:
    secheaders:
      headers:
        frameDeny: true
        contentTypeNosniff: true
        forceSTSHeader: true
        stsSeconds: 63072000
        stsIncludeSubdomains: true
        referrerPolicy: "strict-origin-when-cross-origin"
        permissionsPolicy: "camera=(), microphone=(), geolocation=()"
```

**Docs:** `docs/installation/security-headers.mdx`

---

## H2 — CALL_WEBHOOK SSRF Prevention

### Problem

`packages/core/src/modules/workflows/lib/activity-executor.ts:611`

```typescript
const response = await fetch(url, { method, headers, body })  // no validation
```

`CALL_API` in the same file has explicit SSRF prevention (`buildApiUrl()`, lines 821–851). `CALL_WEBHOOK` does not. Any admin can craft a workflow targeting internal services or cloud metadata endpoints.

### Per-Deployment Assessment

**Proxies do not mitigate this.** CALL_WEBHOOK is an outbound `fetch()` from the Node.js process. Cloudflare Tunnel, Traefik, and Pangolin handle inbound traffic only.

| Deployment | SSRF mitigated by infra? | Risk level |
|-----------|--------------------------|-----------|
| D1 Railway (multi-tenant) | No | **Critical** — AWS IMDS reachable |
| D2 Self-hosted (single-tenant) | No | Low — admin = infra owner |
| D3 Cloudflare Tunnel | No | Low-Medium |
| D4 Traefik/Pangolin | No | Low-Medium |
| D5 Standalone multi-tenant | No | **Critical** |

### Proposed Change

```typescript
function validateWebhookUrl(url: string): void {
  let parsed: URL
  try { parsed = new URL(url) } catch {
    throw new Error(`CALL_WEBHOOK: invalid URL: ${url}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error(`CALL_WEBHOOK: only HTTP/HTTPS allowed`)
  if (process.env.WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS === 'true') return
  const blocked = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|0\.0\.0\.0)/i
  if (blocked.test(parsed.hostname))
    throw new Error(`CALL_WEBHOOK: URL targets a private or reserved address: ${parsed.hostname}`)
}
```

**Docs:** `docs/framework/workflows/security.mdx`

---

## H3 — Integration Credentials Write-Only

### Problem

`packages/core/src/modules/integrations/api/[id]/credentials/route.ts:61`

```typescript
credentials: values ?? {}  // fully decrypted Stripe keys, OAuth tokens
```

### Per-Deployment Assessment

In all documented self-hosted deployments (Cloudflare Tunnel, Traefik/Pangolin), HTTPS terminates at the proxy. Credentials are encrypted in transit. The admin who calls this endpoint already knows their own Stripe key — the concern is secondary exposure (DevTools, proxy logs, screen recording). Low urgency for self-hosted single-tenant.

**Before multi-tenant SaaS launch:** medium urgency.

### Proposed Change (Phase 1)

```typescript
function maskCredentialValue(value: string): string {
  if (typeof value !== 'string' || value.length < 8) return '••••••••'
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`
}
credentials: maskCredentials(values ?? {}),
```

---

## H4 — Pin GitHub Actions

Pin `release.yml` and `qa-deploy.yml` to commit SHAs. Add `.github/dependabot.yml`.

---

## RC1 — Quote Acceptance TOCTOU

### Problem

`packages/core/src/modules/sales/api/quotes/accept/route.ts:41–56`

```typescript
if ((quote.status ?? null) !== 'sent') { throw ... }  // CHECK
quote.status = 'confirmed'                             // UPDATE
await em.flush()                                       // FLUSH — no transaction, no SELECT FOR UPDATE
await commandBus.execute('sales.quotes.convert_to_order', ...)  // CONSEQUENCE
```

No transaction, no SELECT FOR UPDATE. Concurrent requests can both pass the check and both create orders.

**Auth required:** None (public endpoint)
**Impact:** Duplicate orders, inventory corruption, financial fraud

### Proposed Fix

```typescript
await em.transactional(async (txEm) => {
  const quote = await txEm.findOne(SalesQuote,
    { acceptanceToken: token, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE }  // SELECT FOR UPDATE
  )
  if (!quote || quote.status !== 'sent') throw new CrudHttpError(400, ...)
  quote.status = 'confirmed'
  await txEm.flush()
})
// convert_to_order outside the lock
```

---

## RC2 — Session Token Unindexed + Chat Flood

### Problem

1. `packages/core/src/modules/api_keys/data/entities.ts` — `sessionToken` field has no `@Index` or `@Unique` annotation
2. `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts` — no rate limit on session creation
3. `packages/core/src/modules/api_keys/services/apiKeyService.ts:267` — `em.findOne(ApiKey, { sessionToken, deletedAt: null })` is a full table scan

**Auth required:** `ai_assistant.view`
**Impact:** Progressive auth service degradation; MCP tool call timeouts

### Proposed Fix

```typescript
// packages/core/src/modules/api_keys/data/entities.ts
@Index({ properties: ['sessionToken'] })  // add this
@Entity({ tableName: 'api_keys' })
export class ApiKey { ... }
```

Plus rate limit on `/api/chat`: 30 requests/minute per user.

---

## A1 — File Upload No Size Limit

### Problem

`packages/core/src/modules/attachments/api/route.ts:263`

```typescript
const buf = Buffer.from(await file.arrayBuffer())  // entire file loaded into RAM first
```

No global size check before this call. A single large upload can exhaust available memory.

**Auth required:** Attachment upload permission (not admin-only)
**Impact:** OOM crash of Node.js process — all tenants affected

### Proposed Fix

```typescript
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024  // 500MB
const contentLength = Number(req.headers.get('content-length') ?? 0)
if (contentLength > MAX_UPLOAD_BYTES) {
  return NextResponse.json({ error: 'File too large' }, { status: 413 })
}
```

---

## Availability Findings (A2–A8)

| ID | Finding | File | Fix |
|----|---------|------|-----|
| A2 | AI chat no rate limit | `ai_assistant/api/chat/route.ts` | Add `rateLimit: { points: 30, duration: 60 }` to metadata |
| A3 | Workflow list unbounded | `workflows/api/instances/route.ts:59` | `const limit = Math.min(parseInt(...), 100)` |
| A4 | Workflow creation no rate limit | `workflows/api/instances/route.ts` | Add rate limit to POST metadata |
| A5 | Attachment transfer unbounded array | `attachments/api/transfer/route.ts:16` | Add `.max(1000)` to Zod schema |
| A6 | Attachment library GET no pagination | `attachments/api/route.ts:174` | Add `findAndCount` with limit/offset |
| A7 | SSE no per-user connection limit | `events/api/stream/route.ts` | Track connections per userId, reject at N=5 |
| A8 | Search reindex no cooldown | `search/api/embeddings/reindex/route.ts` | Add rate limit: 3/hour per user |

---

## Out of Scope (Assessed and Excluded)

| Finding | Reason |
|---------|--------|
| MCP server `0.0.0.0` binding | Dev tool, not in production deployment |
| Session token in AI system prompt | Trust boundary unchanged; 2h TTL |
| Business rules no pre-ownership check | Engine likely enforces tenantId; low confidence |
| Password minimum 6 chars | bcrypt cost 10 + rate limiting sufficient |
| `next@16.1.5` CVEs | Not exploitable (no Server Actions, no rewrites) |
| Offers enrichment without tenant filter | Requires separate data integrity failure |
| Shell/command injection | Verified absent — `execFile` used correctly, no `eval()` |
| SQL injection | Verified absent — all raw SQL hardcoded or parameterised |
| Privilege escalation (customer/employee) | All paths blocked |

---

## Implementation Checklist

**H2 (P0 — do first)**
- [ ] Add `validateWebhookUrl()` to `activity-executor.ts`, call from `executeCallWebhook()`
- [ ] Add `WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS` to `.env.example`

**H1 (P1)**
- [ ] Add `headers()` to `apps/mercato/next.config.ts`
- [ ] Docs: `docs/installation/security-headers.mdx` (include Traefik + Cloudflare equivalents)

**RC1 (P1)**
- [ ] Wrap quote acceptance in `em.transactional()` with `LockMode.PESSIMISTIC_WRITE`

**RC2 (P1)**
- [ ] Add `@Index` to `sessionToken` in `ApiKey` entity, run `yarn db:generate`
- [ ] Add rate limit to `POST /api/chat`

**A1 (P1)**
- [ ] Check `Content-Length` before `file.arrayBuffer()` in attachments route

**Next.js upgrade (P1)**
- [ ] Upgrade `next` to `>=16.1.7`

**H3 (P2)**
- [ ] Add `maskCredentials()` to `credentials/route.ts` GET response
- [ ] Update PUT to skip mask placeholders

**H4 (P2)**
- [ ] Pin `release.yml` and `qa-deploy.yml` GitHub Actions to SHA
- [ ] Add `.github/dependabot.yml`

**A2–A8 (P3)**
- [ ] Rate limit `/api/chat`, workflow creation, search reindex
- [ ] Cap workflow list `limit`, attachment transfer array, attachment library pagination
- [ ] SSE per-user connection limit

**F17 (infra — operator action)**
- [ ] Firewall port 7700 on `10.0.63.14` — Meilisearch must not be network-accessible

**Docs**
- [ ] `docs/installation/security-headers.mdx`
- [ ] `docs/framework/workflows/security.mdx`
- [ ] `docs/framework/integrations/credentials.mdx`
- [ ] `docs/contributing/ci-security.mdx`
- [ ] `docs/installation/production-checklist.mdx`

---

## Changelog

| Date | Summary |
|------|---------|
| 2026-03-26 | Initial spec — four hardening items |
| 2026-03-26 | Full audit expansion — added F01–F18, RC1–RC3, A1–A8, attack chains, privilege escalation analysis, shell/SQL injection audit, all deployment types |
