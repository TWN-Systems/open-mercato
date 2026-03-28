# Fix Plan: F03 — Missing HTTP Security Headers

**Severity:** Medium
**Status:** Not in any existing spec or roadmap
**Confirmed live:** Yes — all 6 headers absent on 10.0.64.14
**Effort:** 10 min (app-layer) or config (Traefik/Cloudflare)
**Spec reference:** SPEC-061 H1

---

## The Problem

Zero HTTP security headers on any response. Confirmed absent:
- `X-Frame-Options` — clickjacking possible
- `X-Content-Type-Options` — MIME sniffing
- `Strict-Transport-Security` — no HTTPS enforcement
- `Referrer-Policy` — referrer leakage
- `Permissions-Policy` — no browser feature restriction
- `Content-Security-Policy` — no script source restriction (deferred — see below)

Additionally: `X-Powered-By: Next.js` disclosed (fingerprinting).

---

## The Fix

**Option A — App layer (recommended: covers all deployment types):**

**File:** `apps/mercato/next.config.ts`

```typescript
const nextConfig: NextConfig = {
  // ... existing config ...

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // X-Powered-By is removed by default in Next.js production builds
          // If not: add poweredByHeader: false to this config
        ],
      },
    ]
  },

  poweredByHeader: false,  // removes X-Powered-By: Next.js
}
```

**CSP is intentionally omitted here.** The app uses inline scripts (theme init, Turbopack) and dynamic imports that would require a nonce-based CSP. That's a separate piece of work requiring audit of all script sources first. Add CSP in report-only mode as a follow-up.

---

**Option B — Traefik middleware (Pangolin/Netbird deployments):**

```yaml
# traefik/dynamic.yml
http:
  middlewares:
    secheaders:
      headers:
        frameDeny: true
        contentTypeNosniff: true
        forceSTSHeader: true
        stsSeconds: 63072000
        stsIncludeSubdomains: true
        stsPreload: true
        referrerPolicy: "strict-origin-when-cross-origin"
        permissionsPolicy: "camera=(), microphone=(), geolocation=()"
        customResponseHeaders:
          X-Powered-By: ""   # remove
```

**Pick one — do NOT apply both** (duplicate headers cause issues with some CSP parsers).

---

## Existing Coverage to NOT Duplicate

None. This is not covered in any existing spec.

---

## Verification

```bash
curl -sI http://YOUR-APP/ | grep -iE \
  "x-frame|x-content|strict-transport|referrer|permissions|x-powered"

# Expected (after fix):
x-frame-options: SAMEORIGIN
x-content-type-options: nosniff
strict-transport-security: max-age=63072000; includeSubDomains; preload
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
# X-Powered-By: absent
```
