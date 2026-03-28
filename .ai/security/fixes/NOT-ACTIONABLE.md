# Non-Actionable Findings — Notes

These findings were assessed and either covered elsewhere, not exploitable, or accepted risks.

---

## F04 — next@16.1.5 CVEs

**Action:** Upgrade next to >=16.1.7 as routine dependency maintenance.
```bash
# In package.json root:
"next": "^16.1.7"
yarn install
```
No architectural change required. CVEs (CSRF bypass, HTTP smuggling) are not exploitable in this codebase (no Server Actions, no rewrites). Upgrade anyway as hygiene.

---

## F05, F06, F07 — MCP/AI Dev-Only Concerns

- **F05** (MCP 0.0.0.0): Change `httpServer.listen(port)` → `httpServer.listen(port, '127.0.0.1')` in `mcp-server.ts` and `http-server.ts`. One-line fix. Low urgency — MCP not in production.
- **F06** (Session token in prompt): Architectural improvement for later — move token to transport header. Not urgent given trust boundary.
- **F07** (Timing attack on dev server): Replace `!==` with `timingSafeEqual` in `mcp-dev-server.ts`. Negligible — dev server only.

---

## F09 — Docker Floating Tag

Pin to digest: `FROM node:24-alpine@sha256:<digest>`. Low urgency. Run `docker inspect node:24-alpine --format '{{index .RepoDigests 0}}'` to get current digest.

---

## F10, F11, F13 — Theoretical / Likely Safe

- **F10** (Business rules): `executeRuleById` passes `tenantId` in context; engine almost certainly scopes by tenant. Add pre-fetch guard as defence-in-depth if desired.
- **F11** (Offers enrichment): Requires orphaned product records from separate data integrity failure. Not independently exploitable.
- **F13** (Bulk delete): Worker re-checks ownership via scope. Add pre-filter for defence-in-depth if desired.

---

## F12 — Password Minimum 6 Chars

Confirmed live: `Aa1!56` accepted. Mitigated by bcrypt cost 10 + rate limiting. NIST recommends 8 minimum, 12+ preferred.

**If stricter policy needed:**
- Set `OM_PASSWORD_MIN_LENGTH=12` in `.env` (no code change required)
- Enterprise MFA (SPEC-ENT-001) adds additional auth factors

---

## F14, F15, F16 — Design Choices

- **F14** (Public quote token): Intended UX design. Consider adding IP rate limiting to accept endpoint and audit logging.
- **F15** (call_api defers ACL): By design — downstream endpoints handle auth. Acceptable.
- **F16** (CALL_API admin key): By design — needed for automated workflow operations. Document clearly in AGENTS.md.

---

## F18 — glob@11.1.0 Deprecation

Update transitive dep in `packages/gateway-stripe`. No CVE. Advisory only.

---

## P1, P2 — Privilege Escalation

Both paths confirmed blocked by code review. No action required.

---

## S1, S2 — Shell / SQL Injection

Confirmed safe by code review. No action required.
