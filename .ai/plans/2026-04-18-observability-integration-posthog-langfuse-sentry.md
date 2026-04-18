# Observability Integration (PostHog + Langfuse + Sentry) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `.ai/specs/2026-04-18-observability-integration-posthog-langfuse-sentry.md`

**Goal:** Add a workspace package `@open-mercato/observability` registering three independent integration providers (PostHog, Langfuse, Sentry) in the Integration Marketplace — covering server, admin browser, customer portal, and AI assistant LLM tracing — working against both cloud and self-hosted deployments of each tool.

**Architecture:** One module `observability` in `packages/observability/` exports three `IntegrationDefinition`s. Server event forwarding uses a wildcard subscriber → PostHog. Langfuse is wrapped in an `llmTracer` DI token (no-op default in ai-assistant, overridden by observability). Sentry init is a process-global shared instrumentation file. Browser bootstrap is a shell-wrapper widget that dynamically imports `posthog-js` + `@sentry/browser` based on `GET /api/observability/client-config`. Shared: redaction helper, per-tenant config cache, env preset bootstrap.

**Tech Stack:** TypeScript, Next.js App Router, Awilix DI, Jest, Playwright. New deps: `posthog-node`, `posthog-js`, `langfuse`, `@sentry/nextjs`, `@sentry/browser`.

**Reference module for scaffolding:** `packages/gateway-stripe/` — mirror its `package.json` exports block, `build.mjs`, `watch.mjs`, `tsconfig.json`, and `jest.config.cjs` pattern.

---

## File Structure

**New package root**: `packages/observability/`

### Root files (copy verbatim from gateway-stripe then edit)
- `package.json` — change `name` to `@open-mercato/observability`, set `version: 0.1.0`, deps listed in Task 1.
- `build.mjs`, `watch.mjs` — identical to gateway-stripe.
- `tsconfig.json`, `jest.config.cjs` — identical.
- `src/index.ts` — re-exports module.

### Module files (`src/modules/observability/`)

| File | Responsibility |
|---|---|
| `index.ts` | Module metadata (id, title, description) |
| `integration.ts` | Three `IntegrationDefinition` exports + `integrations` array |
| `acl.ts` | Three ACL features |
| `setup.ts` | Default role features + preset bootstrap hook |
| `di.ts` | DI registrations for 7 services |
| `events.ts` | Internal log event declarations (if needed) |
| `cli.ts` | `configure-from-env` + `test-capture` commands |
| `data/validators.ts` | zod schemas for credentials (3 providers) |
| `lib/redaction.ts` | PII scrubber (pure fn) |
| `lib/tenant-config.ts` | Cached per-tenant resolver |
| `lib/preset.ts` | Env → credentials apply |
| `lib/posthog-client.ts` | Lazy PostHog node client factory |
| `lib/langfuse-client.ts` | Lazy Langfuse client factory |
| `lib/sentry-server.ts` | Sentry server init + `withTenantScope` helper |
| `lib/sentry-instrumentation.ts` | Re-exportable instrumentation entry |
| `lib/llm-tracer.ts` | `LLMTracer` interface + Langfuse-backed impl + no-op |
| `lib/event-mapper.ts` | Open-mercato event → PostHog capture payload |
| `lib/health/posthog.ts`, `langfuse.ts`, `sentry.ts` | Health-check services |
| `api/get/observability/client-config.ts` | Browser-safe config endpoint |
| `subscribers/forward-events.ts` | Wildcard subscriber → PostHog |
| `widgets/injection-table.ts` | Widget-to-slot mappings |
| `widgets/injection/admin-shell/widget.client.tsx` | Admin shell wrapper (PostHog + Sentry) |
| `widgets/injection/portal-shell/widget.client.tsx` | Portal shell wrapper (same) |
| `widgets/injection/integration-detail/posthog-panel.client.tsx` | Optional detail tab |
| `widgets/injection/integration-detail/langfuse-panel.client.tsx` | Optional detail tab |
| `widgets/injection/integration-detail/sentry-panel.client.tsx` | Optional detail tab |
| `i18n/en.ts`, `i18n/pl.ts` | Translation strings |
| `__tests__/*.test.ts` | Co-located unit tests |

### Consumer-side touchpoints
- `apps/mercato/src/modules.ts` — add `'@open-mercato/observability'` entry.
- `apps/mercato/instrumentation.ts` — create or append one-line Sentry delegation.
- `packages/ai-assistant/src/modules/ai_assistant/di.ts` — register `llmTracer` no-op default.
- `packages/ai-assistant/src/modules/ai_assistant/**/<LLM-call-site>.ts` — wrap calls with `tracer.traceLLM(...)`.

---

## Phase 0 — Package Scaffold

### Task 1: Create the `@open-mercato/observability` workspace package

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/build.mjs` (copy of `packages/gateway-stripe/build.mjs`)
- Create: `packages/observability/watch.mjs` (copy of `packages/gateway-stripe/watch.mjs`)
- Create: `packages/observability/tsconfig.json` (copy of `packages/gateway-stripe/tsconfig.json`)
- Create: `packages/observability/jest.config.cjs` (copy of `packages/gateway-stripe/jest.config.cjs`)
- Create: `packages/observability/src/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@open-mercato/observability",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node watch.mjs",
    "test": "jest --config jest.config.cjs",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": "./dist/index.js",
    "./*.ts": { "types": "./src/*.ts", "default": "./dist/*.js" },
    "./*.tsx": { "types": "./src/*.tsx", "default": "./dist/*.js" },
    "./*.json": "./src/*.json",
    "./*": { "types": ["./src/*.ts", "./src/*.tsx"], "default": "./dist/*.js" },
    "./*/*.json": "./src/*/*.json",
    "./*/*": { "types": ["./src/*/*.ts", "./src/*/*.tsx"], "default": "./dist/*/*.js" },
    "./*/*/*.json": "./src/*/*/*.json",
    "./*/*/*": { "types": ["./src/*/*/*.ts", "./src/*/*/*.tsx"], "default": "./dist/*/*/*.js" },
    "./*/*/*/*.json": "./src/*/*/*/*.json",
    "./*/*/*/*": { "types": ["./src/*/*/*/*.ts", "./src/*/*/*/*.tsx"], "default": "./dist/*/*/*/*.js" },
    "./*/*/*/*/*.json": "./src/*/*/*/*/*.json",
    "./*/*/*/*/*": { "types": ["./src/*/*/*/*/*.ts", "./src/*/*/*/*/*.tsx"], "default": "./dist/*/*/*/*/*.js" }
  },
  "dependencies": {
    "@open-mercato/core": "workspace:*",
    "@open-mercato/events": "workspace:*",
    "@open-mercato/ui": "workspace:*",
    "langfuse": "^3.0.0",
    "posthog-node": "^4.0.0"
  },
  "peerDependencies": {
    "@mikro-orm/postgresql": "^6.6.10",
    "@open-mercato/shared": "workspace:*",
    "@sentry/browser": "^8.0.0",
    "@sentry/nextjs": "^8.0.0",
    "posthog-js": "^1.160.0",
    "react": "^19.0.0"
  },
  "peerDependenciesMeta": {
    "@sentry/browser": { "optional": true },
    "@sentry/nextjs": { "optional": true },
    "posthog-js": { "optional": true }
  },
  "devDependencies": {
    "@open-mercato/shared": "workspace:*",
    "@sentry/browser": "^8.0.0",
    "@sentry/nextjs": "^8.0.0",
    "@types/jest": "^30.0.0",
    "esbuild": "^0.25.2",
    "glob": "^11.0.3",
    "jest": "^30.2.0",
    "posthog-js": "^1.160.0",
    "ts-jest": "^29.4.6"
  },
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: Copy scaffolding files verbatim**

```bash
cp packages/gateway-stripe/build.mjs packages/observability/build.mjs
cp packages/gateway-stripe/watch.mjs packages/observability/watch.mjs
cp packages/gateway-stripe/tsconfig.json packages/observability/tsconfig.json
cp packages/gateway-stripe/jest.config.cjs packages/observability/jest.config.cjs
```

- [ ] **Step 3: Write `src/index.ts`**

```ts
export * from './modules/observability'
```

- [ ] **Step 4: Install new deps at monorepo root**

```bash
yarn install
```

Expected: resolves `posthog-node`, `posthog-js`, `langfuse`, `@sentry/nextjs`, `@sentry/browser` into root `node_modules`.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/package.json packages/observability/build.mjs packages/observability/watch.mjs packages/observability/tsconfig.json packages/observability/jest.config.cjs packages/observability/src/index.ts yarn.lock
git commit -m "feat(observability): scaffold workspace package"
```

---

### Task 2: Module metadata, ACL, and IntegrationDefinitions

**Files:**
- Create: `packages/observability/src/modules/observability/index.ts`
- Create: `packages/observability/src/modules/observability/acl.ts`
- Create: `packages/observability/src/modules/observability/integration.ts`
- Create: `packages/observability/src/modules/observability/data/validators.ts`

- [ ] **Step 1: Write module metadata (`index.ts`)**

```ts
export const metadata = {
  id: 'observability',
  title: 'Observability',
  description: 'Product analytics, LLM tracing, and error monitoring via PostHog, Langfuse, and Sentry.',
}
```

- [ ] **Step 2: Write `acl.ts`**

```ts
export const features = [
  { id: 'observability.view', title: 'View observability integrations', module: 'observability' },
  { id: 'observability.manage', title: 'Enable/disable observability integrations', module: 'observability' },
  { id: 'observability.credentials.manage', title: 'Manage observability credentials', module: 'observability' },
]

export default features
```

- [ ] **Step 3: Write `data/validators.ts`**

```ts
import { z } from 'zod'

export const posthogCredentialsSchema = z.object({
  projectKey: z.string().min(1),
  host: z.string().url().default('https://us.i.posthog.com'),
  allowlist: z.array(z.string()).optional(),
  denylist: z.array(z.string()).optional(),
  sessionRecording: z.boolean().optional().default(false),
  redactionKeys: z.array(z.string()).optional(),
})
export type PosthogCredentials = z.infer<typeof posthogCredentialsSchema>

export const langfuseCredentialsSchema = z.object({
  publicKey: z.string().min(1),
  secretKey: z.string().min(1),
  host: z.string().url().default('https://cloud.langfuse.com'),
  redactionKeys: z.array(z.string()).optional(),
})
export type LangfuseCredentials = z.infer<typeof langfuseCredentialsSchema>

export const sentryCredentialsSchema = z.object({
  dsn: z.string().min(1),
  environment: z.string().optional(),
  tracesSampleRate: z.number().min(0).max(1).optional().default(0.1),
  redactionKeys: z.array(z.string()).optional(),
})
export type SentryCredentials = z.infer<typeof sentryCredentialsSchema>
```

- [ ] **Step 4: Write `integration.ts`**

```ts
import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const posthogDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_posthog')
export const langfuseDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_langfuse')
export const sentryDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_sentry')

export const posthogIntegration: IntegrationDefinition = {
  id: 'observability_posthog',
  title: 'PostHog',
  description: 'Product analytics with autocapture, funnels, cohorts, and session replay. Cloud or self-hosted.',
  category: 'analytics',
  hub: 'observability',
  providerKey: 'posthog',
  icon: 'posthog',
  docsUrl: 'https://posthog.com/docs',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['analytics', 'session-replay', 'events', 'self-hosted'],
  detailPage: { widgetSpotId: posthogDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'projectKey', label: 'Project API Key', type: 'secret', required: true, placeholder: 'phc_...', helpText: 'Project API key from PostHog project settings. Works for both cloud and self-hosted.' },
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'https://us.i.posthog.com', helpText: 'PostHog API host. Cloud: us.i.posthog.com or eu.i.posthog.com. Self-hosted: your deployment URL.' },
      { key: 'sessionRecording', label: 'Enable Session Recording', type: 'boolean', required: false, helpText: 'Records browser sessions for playback. Disabled by default.' },
    ],
  },
  healthCheck: { service: 'posthogHealthCheck' },
}

export const langfuseIntegration: IntegrationDefinition = {
  id: 'observability_langfuse',
  title: 'Langfuse',
  description: 'LLM observability: traces, generations, token and cost accounting for AI workflows. Cloud or self-hosted.',
  category: 'ai',
  hub: 'observability',
  providerKey: 'langfuse',
  icon: 'langfuse',
  docsUrl: 'https://langfuse.com/docs',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['ai', 'llm', 'tracing', 'observability', 'self-hosted'],
  detailPage: { widgetSpotId: langfuseDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'publicKey', label: 'Public Key', type: 'text', required: true, placeholder: 'pk-lf-...', helpText: 'Langfuse project public key.' },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true, placeholder: 'sk-lf-...', helpText: 'Langfuse project secret key.' },
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'https://cloud.langfuse.com', helpText: 'Langfuse API host. Use your self-hosted URL if applicable.' },
    ],
  },
  healthCheck: { service: 'langfuseHealthCheck' },
}

export const sentryIntegration: IntegrationDefinition = {
  id: 'observability_sentry',
  title: 'Sentry',
  description: 'Error and performance monitoring across server, admin, and customer portal. Cloud or self-hosted.',
  category: 'monitoring',
  hub: 'observability',
  providerKey: 'sentry',
  icon: 'sentry',
  docsUrl: 'https://docs.sentry.io',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['errors', 'performance', 'monitoring', 'self-hosted'],
  detailPage: { widgetSpotId: sentryDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'dsn', label: 'DSN', type: 'secret', required: true, placeholder: 'https://<key>@<host>/<project>', helpText: 'Sentry DSN. Host inside the DSN determines cloud vs self-hosted routing.' },
      { key: 'environment', label: 'Environment', type: 'text', required: false, placeholder: 'production', helpText: 'Tag events with an environment name. Defaults to NODE_ENV.' },
      { key: 'tracesSampleRate', label: 'Traces Sample Rate', type: 'text', required: false, placeholder: '0.1', helpText: 'Fraction of transactions to record (0.0–1.0). Default 0.1.' },
    ],
  },
  healthCheck: { service: 'sentryHealthCheck' },
}

export const integration = posthogIntegration
export const integrations: IntegrationDefinition[] = [posthogIntegration, langfuseIntegration, sentryIntegration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
```

- [ ] **Step 5: Run generator**

```bash
yarn generate
```

Expected: observability module discovered; three integration tiles registered.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/modules/observability/index.ts packages/observability/src/modules/observability/acl.ts packages/observability/src/modules/observability/integration.ts packages/observability/src/modules/observability/data/validators.ts apps/mercato/.mercato/generated
git commit -m "feat(observability): module metadata, ACL, and integration definitions"
```

---

### Task 3: Register observability in the mercato app

**Files:**
- Modify: `apps/mercato/src/modules.ts`

- [ ] **Step 1: Read current modules file to find insertion point**

Run: `cat apps/mercato/src/modules.ts`

Identify the array/object where workspace packages are listed (likely similar entries for `@open-mercato/gateway-stripe`).

- [ ] **Step 2: Add observability entry**

Add `'@open-mercato/observability'` alongside other `@open-mercato/<package>` entries, following the file's existing format.

- [ ] **Step 3: Run prepare**

```bash
npm run modules:prepare
```

Expected: no errors; observability module registered.

- [ ] **Step 4: Verify**

```bash
yarn dev:greenfield 2>&1 | head -50
```

Expected: startup completes; three tiles visible at `/backend/integrations` (manual check once test fixture is in place — verified formally in Phase 7).

- [ ] **Step 5: Commit**

```bash
git add apps/mercato/src/modules.ts apps/mercato/.mercato/generated
git commit -m "feat(observability): register module in mercato app"
```

---

## Phase 1 — Shared Infrastructure

### Task 4: Redaction utility (TDD)

**Files:**
- Create: `packages/observability/src/modules/observability/lib/redaction.ts`
- Test: `packages/observability/src/modules/observability/__tests__/redaction.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/redaction.test.ts
import { scrub } from '../lib/redaction'

describe('scrub', () => {
  it('redacts top-level sensitive keys', () => {
    const input = { password: 'abc', name: 'Alice' }
    expect(scrub(input)).toEqual({ password: '[REDACTED]', name: 'Alice' })
  })

  it('redacts nested sensitive keys case-insensitively', () => {
    const input = { user: { apiKey: 'x', Email: 'a@b.com' } }
    expect(scrub(input)).toEqual({ user: { apiKey: '[REDACTED]', Email: 'a@b.com' } })
  })

  it('redacts inside arrays of objects', () => {
    const input = { items: [{ token: 't1' }, { token: 't2' }] }
    expect(scrub(input)).toEqual({ items: [{ token: '[REDACTED]' }, { token: '[REDACTED]' }] })
  })

  it('truncates string values larger than 8KB', () => {
    const big = 'a'.repeat(8193)
    const out = scrub({ note: big }) as { note: string }
    expect(out.note).toBe(`[TRUNCATED:8193]`)
  })

  it('accepts opt-in extra redaction keys', () => {
    const input = { internalId: 'abc', other: 'ok' }
    const out = scrub(input, { extraKeys: ['internalId'] }) as Record<string, unknown>
    expect(out.internalId).toBe('[REDACTED]')
    expect(out.other).toBe('ok')
  })

  it('preserves null and undefined', () => {
    expect(scrub({ a: null, b: undefined })).toEqual({ a: null, b: undefined })
  })

  it('does not mutate the input', () => {
    const input = { password: 'abc' }
    scrub(input)
    expect(input).toEqual({ password: 'abc' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/observability && yarn test redaction
```

Expected: FAIL — `Cannot find module '../lib/redaction'`.

- [ ] **Step 3: Write implementation**

```ts
// lib/redaction.ts
const DEFAULT_SENSITIVE_PATTERN = /^(password|secret|token|apiKey|privateKey|authorization|cookie|sessionId|creditCard|cvv|ssn|dsn)/i
const MAX_STRING_LENGTH = 8192

type ScrubOptions = { extraKeys?: string[] }

function isSensitiveKey(key: string, extraKeys: string[]): boolean {
  if (DEFAULT_SENSITIVE_PATTERN.test(key)) return true
  const lower = key.toLowerCase()
  return extraKeys.some((k) => k.toLowerCase() === lower)
}

export function scrub<T>(value: T, options: ScrubOptions = {}): T {
  const extraKeys = options.extraKeys ?? []
  return walk(value, extraKeys) as T
}

function walk(value: unknown, extraKeys: string[]): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `[TRUNCATED:${value.length}]` : value
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, extraKeys))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k, extraKeys) && v !== undefined && v !== null ? '[REDACTED]' : walk(v, extraKeys)
    }
    return out
  }
  return value
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/observability && yarn test redaction
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/lib/redaction.ts packages/observability/src/modules/observability/__tests__/redaction.test.ts
git commit -m "feat(observability): redaction helper with tests"
```

---

### Task 5: Tenant config resolver with event-driven cache invalidation (TDD)

**Files:**
- Create: `packages/observability/src/modules/observability/lib/tenant-config.ts`
- Test: `packages/observability/src/modules/observability/__tests__/tenant-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/tenant-config.test.ts
import { createTenantConfigResolver } from '../lib/tenant-config'

const makeDeps = () => {
  const credentials = new Map<string, unknown>()
  const enabled = new Map<string, boolean>()
  return {
    credentials,
    enabled,
    credentialsService: {
      findOneWithDecryption: jest.fn(async (q: any) => {
        const k = `${q.integrationId}:${q.tenantId}`
        return credentials.has(k) ? { data: credentials.get(k) } : null
      }),
    },
    stateService: {
      findOne: jest.fn(async (q: any) => {
        const k = `${q.integrationId}:${q.tenantId}`
        return enabled.has(k) ? { enabled: enabled.get(k) } : null
      }),
    },
  }
}

describe('tenant config resolver', () => {
  it('returns disabled entries as null', async () => {
    const deps = makeDeps()
    const resolver = createTenantConfigResolver(deps as any)
    const cfg = await resolver.get('tenant-1')
    expect(cfg.posthog).toBeNull()
    expect(cfg.langfuse).toBeNull()
    expect(cfg.sentry).toBeNull()
  })

  it('returns credentials when enabled', async () => {
    const deps = makeDeps()
    deps.enabled.set('observability_posthog:tenant-1', true)
    deps.credentials.set('observability_posthog:tenant-1', { projectKey: 'k', host: 'https://us.i.posthog.com' })
    const resolver = createTenantConfigResolver(deps as any)
    const cfg = await resolver.get('tenant-1')
    expect(cfg.posthog).toEqual({ projectKey: 'k', host: 'https://us.i.posthog.com' })
  })

  it('caches results', async () => {
    const deps = makeDeps()
    const resolver = createTenantConfigResolver(deps as any)
    await resolver.get('tenant-1')
    await resolver.get('tenant-1')
    expect(deps.credentialsService.findOneWithDecryption).toHaveBeenCalledTimes(3) // 3 providers, first call only
  })

  it('invalidates on invalidate(tenantId)', async () => {
    const deps = makeDeps()
    const resolver = createTenantConfigResolver(deps as any)
    await resolver.get('tenant-1')
    resolver.invalidate('tenant-1')
    await resolver.get('tenant-1')
    expect(deps.credentialsService.findOneWithDecryption).toHaveBeenCalledTimes(6)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/observability && yarn test tenant-config
```

Expected: FAIL — `Cannot find module '../lib/tenant-config'`.

- [ ] **Step 3: Write implementation**

```ts
// lib/tenant-config.ts
import type { PosthogCredentials, LangfuseCredentials, SentryCredentials } from '../data/validators'

const INTEGRATION_IDS = {
  posthog: 'observability_posthog',
  langfuse: 'observability_langfuse',
  sentry: 'observability_sentry',
} as const

export type TenantObservabilityConfig = {
  posthog: PosthogCredentials | null
  langfuse: LangfuseCredentials | null
  sentry: SentryCredentials | null
}

type CredentialsService = {
  findOneWithDecryption: (q: { integrationId: string; tenantId: string }) => Promise<{ data: unknown } | null>
}
type StateService = {
  findOne: (q: { integrationId: string; tenantId: string }) => Promise<{ enabled: boolean } | null>
}

type Deps = { credentialsService: CredentialsService; stateService: StateService }

export function createTenantConfigResolver(deps: Deps) {
  const cache = new Map<string, TenantObservabilityConfig>()

  async function resolveOne<T>(integrationId: string, tenantId: string): Promise<T | null> {
    const state = await deps.stateService.findOne({ integrationId, tenantId })
    if (!state?.enabled) return null
    const creds = await deps.credentialsService.findOneWithDecryption({ integrationId, tenantId })
    return (creds?.data ?? null) as T | null
  }

  async function load(tenantId: string): Promise<TenantObservabilityConfig> {
    const [posthog, langfuse, sentry] = await Promise.all([
      resolveOne<PosthogCredentials>(INTEGRATION_IDS.posthog, tenantId),
      resolveOne<LangfuseCredentials>(INTEGRATION_IDS.langfuse, tenantId),
      resolveOne<SentryCredentials>(INTEGRATION_IDS.sentry, tenantId),
    ])
    return { posthog, langfuse, sentry }
  }

  return {
    async get(tenantId: string): Promise<TenantObservabilityConfig> {
      const hit = cache.get(tenantId)
      if (hit) return hit
      const cfg = await load(tenantId)
      cache.set(tenantId, cfg)
      return cfg
    },
    invalidate(tenantId: string) {
      cache.delete(tenantId)
    },
    invalidateAll() {
      cache.clear()
    },
  }
}

export type TenantConfigResolver = ReturnType<typeof createTenantConfigResolver>
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/observability && yarn test tenant-config
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/lib/tenant-config.ts packages/observability/src/modules/observability/__tests__/tenant-config.test.ts
git commit -m "feat(observability): per-tenant config resolver with cache"
```

---

### Task 6: Event mapper for PostHog (TDD)

**Files:**
- Create: `packages/observability/src/modules/observability/lib/event-mapper.ts`
- Test: `packages/observability/src/modules/observability/__tests__/event-mapper.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/event-mapper.test.ts
import { mapEventToCapture, shouldForward } from '../lib/event-mapper'

describe('shouldForward', () => {
  it('allows events in the allowlist', () => {
    expect(shouldForward('sales.order.created', { allowlist: ['sales.order.created'], denylist: [] })).toBe(true)
  })
  it('denies events not in allowlist when allowlist is non-empty', () => {
    expect(shouldForward('sales.order.updated', { allowlist: ['sales.order.created'], denylist: [] })).toBe(false)
  })
  it('allows all when allowlist is empty', () => {
    expect(shouldForward('anything.foo.bar', { allowlist: [], denylist: [] })).toBe(true)
  })
  it('denies events matching denylist substring', () => {
    expect(shouldForward('integrations.log.created', { allowlist: [], denylist: ['integrations.log'] })).toBe(false)
    expect(shouldForward('auth.credentials.rotated', { allowlist: [], denylist: ['credentials'] })).toBe(false)
  })
  it('denylist takes precedence over allowlist', () => {
    expect(shouldForward('auth.credentials.rotated', { allowlist: ['auth.credentials.rotated'], denylist: ['credentials'] })).toBe(false)
  })
})

describe('mapEventToCapture', () => {
  it('uses actor user id as distinctId when available', () => {
    const p = mapEventToCapture({
      eventId: 'sales.order.created',
      payload: { orderId: '1', actorUserId: 'u-1', organizationId: 'o-1' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.distinctId).toBe('u-1')
    expect(p.event).toBe('sales.order.created')
    expect(p.groups).toEqual({ tenant: 't-1', organization: 'o-1' })
  })

  it('falls back to system distinctId when no actor', () => {
    const p = mapEventToCapture({
      eventId: 'auth.system.cleanup',
      payload: {},
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.distinctId).toBe('tenant:t-1:system')
  })

  it('scrubs sensitive keys from properties', () => {
    const p = mapEventToCapture({
      eventId: 'auth.user.loggedIn',
      payload: { userId: 'u-1', password: 'nope', token: 't' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect((p.properties as any).password).toBe('[REDACTED]')
    expect((p.properties as any).token).toBe('[REDACTED]')
  })

  it('stamps version and tenant/org onto properties', () => {
    const p = mapEventToCapture({
      eventId: 'sales.order.created',
      payload: { organizationId: 'o-1' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.properties).toMatchObject({ tenant_id: 't-1', organization_id: 'o-1', open_mercato_version: '1.0.0' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/observability && yarn test event-mapper
```

Expected: FAIL.

- [ ] **Step 3: Write implementation**

```ts
// lib/event-mapper.ts
import { scrub } from './redaction'

export type FilterConfig = { allowlist: string[]; denylist: string[] }
export type CapturePayload = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
  groups: { tenant: string; organization?: string }
}

export function shouldForward(eventId: string, filter: FilterConfig): boolean {
  for (const denied of filter.denylist) {
    if (eventId.toLowerCase().includes(denied.toLowerCase())) return false
  }
  if (filter.allowlist.length === 0) return true
  return filter.allowlist.includes(eventId)
}

type MapInput = {
  eventId: string
  payload: Record<string, unknown>
  tenantId: string
  openMercatoVersion: string
  extraRedactionKeys?: string[]
}

export function mapEventToCapture(input: MapInput): CapturePayload {
  const actorUserId = typeof input.payload.actorUserId === 'string' ? input.payload.actorUserId : undefined
  const userId = typeof input.payload.userId === 'string' ? input.payload.userId : undefined
  const organizationId = typeof input.payload.organizationId === 'string' ? input.payload.organizationId : undefined
  const distinctId = actorUserId ?? userId ?? `tenant:${input.tenantId}:system`
  const scrubbed = scrub(input.payload, { extraKeys: input.extraRedactionKeys ?? [] }) as Record<string, unknown>
  return {
    distinctId,
    event: input.eventId,
    properties: {
      ...scrubbed,
      tenant_id: input.tenantId,
      organization_id: organizationId,
      open_mercato_version: input.openMercatoVersion,
    },
    groups: { tenant: input.tenantId, organization: organizationId },
  }
}

export const DEFAULT_ALLOWLIST = [
  'auth.user.loggedIn',
  'sales.order.created',
  'sales.quote.accepted',
  'catalog.product.created',
  'customers.person.created',
  'integrations.state.updated',
  'workflows.instance.completed',
]

export const DEFAULT_DENYLIST = [
  'credentials',
  'secret',
  'password',
  'integrations.log',
]
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/observability && yarn test event-mapper
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/lib/event-mapper.ts packages/observability/src/modules/observability/__tests__/event-mapper.test.ts
git commit -m "feat(observability): event mapper with allowlist/denylist logic"
```

---

## Phase 2 — PostHog

### Task 7: PostHog client factory + health check

**Files:**
- Create: `packages/observability/src/modules/observability/lib/posthog-client.ts`
- Create: `packages/observability/src/modules/observability/lib/health/posthog.ts`
- Test: `packages/observability/src/modules/observability/__tests__/posthog-health.test.ts`

- [ ] **Step 1: Write `lib/posthog-client.ts`**

```ts
import { PostHog } from 'posthog-node'
import type { PosthogCredentials } from '../data/validators'

type ClientCacheKey = string
const clients = new Map<ClientCacheKey, PostHog>()

export function getPosthogClient(tenantId: string, creds: PosthogCredentials): PostHog {
  const key = `${tenantId}:${creds.host}:${creds.projectKey}`
  const existing = clients.get(key)
  if (existing) return existing
  const client = new PostHog(creds.projectKey, { host: creds.host, flushAt: 20, flushInterval: 10_000 })
  clients.set(key, client)
  return client
}

export async function shutdownPosthogClients(): Promise<void> {
  const all = Array.from(clients.values())
  clients.clear()
  await Promise.all(all.map((c) => c.shutdown()))
}
```

- [ ] **Step 2: Write failing health-check test**

```ts
// __tests__/posthog-health.test.ts
import { createPosthogHealthCheck } from '../lib/health/posthog'

describe('posthogHealthCheck', () => {
  it('returns healthy when capture succeeds', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 })) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://us.i.posthog.com', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('healthy')
  })

  it('returns unhealthy on non-ok response', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 401 })) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://us.i.posthog.com', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('401')
  })

  it('returns unhealthy on thrown error', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('DNS failure') }) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://bad', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('DNS')
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd packages/observability && yarn test posthog-health
```

- [ ] **Step 4: Write `lib/health/posthog.ts`**

```ts
import type { PosthogCredentials } from '../../data/validators'

type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createPosthogHealthCheck(deps: Deps = { fetch }) {
  return async function posthogHealthCheck(creds: PosthogCredentials): Promise<HealthResult> {
    try {
      const url = `${creds.host.replace(/\/$/, '')}/decide/?v=3`
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: creds.projectKey, distinct_id: 'health-check' }),
      })
      if (!res.ok) return { status: 'unhealthy', message: `PostHog returned HTTP ${res.status}` }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const posthogHealthCheck = createPosthogHealthCheck()
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd packages/observability && yarn test posthog-health
```

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/modules/observability/lib/posthog-client.ts packages/observability/src/modules/observability/lib/health/posthog.ts packages/observability/src/modules/observability/__tests__/posthog-health.test.ts
git commit -m "feat(observability): PostHog client factory and health check"
```

---

### Task 8: Wildcard subscriber forwarding events to PostHog

**Files:**
- Create: `packages/observability/src/modules/observability/subscribers/forward-events.ts`

- [ ] **Step 1: Inspect existing subscriber shape**

Run: `cat packages/core/src/modules/integrations/subscribers/ | head -40` and pick an existing subscriber (e.g. any file under `packages/core/src/modules/integrations/subscribers/`) to confirm the `metadata` shape and handler signature.

- [ ] **Step 2: Write the subscriber**

```ts
// subscribers/forward-events.ts
import type { AwilixContainer } from 'awilix'
import { getPosthogClient } from '../lib/posthog-client'
import { mapEventToCapture, shouldForward, DEFAULT_ALLOWLIST, DEFAULT_DENYLIST } from '../lib/event-mapper'
import type { TenantConfigResolver } from '../lib/tenant-config'

export const metadata = {
  event: '*',
  persistent: false,
  id: 'observability.posthog.forward',
}

export default async function forwardEvents(
  event: { id: string; payload: Record<string, unknown>; tenantId?: string },
  container: AwilixContainer
): Promise<void> {
  if (!event.tenantId) return
  const resolver = container.resolve<TenantConfigResolver>('observabilityTenantConfig')
  const cfg = (await resolver.get(event.tenantId)).posthog
  if (!cfg) return

  const allowlist = cfg.allowlist ?? DEFAULT_ALLOWLIST
  const denylist = cfg.denylist ?? DEFAULT_DENYLIST
  if (!shouldForward(event.id, { allowlist, denylist })) return

  try {
    const version = process.env.OM_VERSION ?? 'unknown'
    const payload = mapEventToCapture({
      eventId: event.id,
      payload: event.payload,
      tenantId: event.tenantId,
      openMercatoVersion: version,
      extraRedactionKeys: cfg.redactionKeys,
    })
    const client = getPosthogClient(event.tenantId, cfg)
    client.capture({
      distinctId: payload.distinctId,
      event: payload.event,
      properties: payload.properties,
      groups: payload.groups,
    })
  } catch (err) {
    const log = container.resolve<any>('integrationLogService')
    log.write({
      integrationId: 'observability_posthog',
      tenantId: event.tenantId,
      level: 'error',
      message: 'PostHog event forwarding failed',
      payload: { eventId: event.id, error: err instanceof Error ? err.message : String(err) },
    }).catch(() => undefined)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/subscribers/forward-events.ts
git commit -m "feat(observability): wildcard subscriber forwards events to PostHog"
```

---

## Phase 3 — Sentry

### Task 9: Sentry server init + `withTenantScope` helper

**Files:**
- Create: `packages/observability/src/modules/observability/lib/sentry-server.ts`
- Create: `packages/observability/src/modules/observability/lib/sentry-instrumentation.ts`

- [ ] **Step 1: Write `lib/sentry-server.ts`**

```ts
import * as Sentry from '@sentry/nextjs'
import { scrub } from './redaction'
import type { SentryCredentials } from '../data/validators'

let initialized = false

export function initSentry(creds: SentryCredentials | undefined | null): void {
  if (initialized) return
  const dsn = creds?.dsn ?? process.env.SENTRY_DSN ?? process.env.OM_INTEGRATION_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: creds?.environment ?? process.env.NODE_ENV,
    tracesSampleRate: creds?.tracesSampleRate ?? 0.1,
    beforeSend(event) {
      if (event.request?.cookies) event.request.cookies = { redacted: '[REDACTED]' }
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>
        for (const k of Object.keys(headers)) {
          if (/^(authorization|cookie|x-api-key)$/i.test(k)) headers[k] = '[REDACTED]'
        }
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>
      return event
    },
  })
  initialized = true
}

export function withTenantScope<T>(
  scope: { tenantId?: string; organizationId?: string; userId?: string },
  fn: () => T
): T {
  return Sentry.withScope((s) => {
    if (scope.tenantId) s.setTag('tenant_id', scope.tenantId)
    if (scope.organizationId) s.setTag('organization_id', scope.organizationId)
    if (scope.userId) s.setUser({ id: scope.userId })
    return fn()
  })
}

export function sentryInitialized(): boolean {
  return initialized
}
```

- [ ] **Step 2: Write `lib/sentry-instrumentation.ts`**

```ts
import { initSentry } from './sentry-server'

export function registerSentryInstrumentation(): void {
  initSentry(null)
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/lib/sentry-server.ts packages/observability/src/modules/observability/lib/sentry-instrumentation.ts
git commit -m "feat(observability): Sentry server init with tenant scope helper"
```

---

### Task 10: Wire Sentry instrumentation into mercato app

**Files:**
- Create or modify: `apps/mercato/instrumentation.ts`

- [ ] **Step 1: Check existing**

Run: `cat apps/mercato/instrumentation.ts 2>/dev/null || echo "does not exist"`

- [ ] **Step 2a: If file does not exist — create it**

```ts
// apps/mercato/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerSentryInstrumentation } = await import('@open-mercato/observability/modules/observability/lib/sentry-instrumentation')
    registerSentryInstrumentation()
  }
}
```

- [ ] **Step 2b: If file exists — append the import and call inside `register()`**

Add the same body inside the existing `register()` function. If no `register()` exists, export one as above.

- [ ] **Step 3: Commit**

```bash
git add apps/mercato/instrumentation.ts
git commit -m "feat(observability): wire Sentry instrumentation into mercato app"
```

---

### Task 11: Sentry API interceptor to tag tenant/org/user on every request

**Files:**
- Create: `packages/observability/src/modules/observability/api/interceptors.ts`

- [ ] **Step 1: Inspect existing interceptor example**

Run: `cat packages/core/src/modules/integrations/api/interceptors.ts 2>/dev/null | head -50` and confirm shape (import of `ApiInterceptor`, export of `interceptors: ApiInterceptor[]`).

- [ ] **Step 2: Write interceptor**

```ts
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { withTenantScope, sentryInitialized } from '../lib/sentry-server'

const tenantTagInterceptor: ApiInterceptor = {
  id: 'observability.sentry.tenant-tag',
  route: '*',
  method: '*',
  priority: 10,
  async before(ctx, next) {
    if (!sentryInitialized()) return next()
    return withTenantScope(
      {
        tenantId: ctx.auth?.tenantId,
        organizationId: ctx.auth?.organizationId,
        userId: ctx.auth?.userId,
      },
      () => next()
    )
  },
}

export const interceptors: ApiInterceptor[] = [tenantTagInterceptor]
```

- [ ] **Step 3: Verify contract**

Run: `yarn typecheck --filter=@open-mercato/observability` (or project-wide `yarn typecheck`).

Expected: no type errors. If `ApiInterceptor`'s `before` signature differs, adapt based on inspected example. Keep the semantic: fail-open on missing scope.

- [ ] **Step 4: Commit**

```bash
git add packages/observability/src/modules/observability/api/interceptors.ts
git commit -m "feat(observability): Sentry tenant-scope interceptor"
```

---

### Task 12: Sentry health check

**Files:**
- Create: `packages/observability/src/modules/observability/lib/health/sentry.ts`
- Test: `packages/observability/src/modules/observability/__tests__/sentry-health.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createSentryHealthCheck } from '../lib/health/sentry'

describe('sentryHealthCheck', () => {
  it('rejects malformed DSN', async () => {
    const fn = createSentryHealthCheck({ fetch: (jest.fn() as any) })
    const res = await fn({ dsn: 'not-a-url' } as any)
    expect(res.status).toBe('unhealthy')
  })

  it('returns healthy when DSN is parseable and host reachable', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 })) as any
    const fn = createSentryHealthCheck({ fetch: fetchMock })
    const res = await fn({ dsn: 'https://abc@sentry.io/123' } as any)
    expect(res.status).toBe('healthy')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/observability && yarn test sentry-health
```

- [ ] **Step 3: Write implementation**

```ts
// lib/health/sentry.ts
type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createSentryHealthCheck(deps: Deps = { fetch }) {
  return async function sentryHealthCheck(creds: { dsn: string }): Promise<HealthResult> {
    try {
      const url = new URL(creds.dsn)
      const pingUrl = `${url.protocol}//${url.host}/`
      const res = await deps.fetch(pingUrl, { method: 'HEAD' })
      if (!res.ok && res.status !== 405) {
        return { status: 'unhealthy', message: `Sentry host returned HTTP ${res.status}` }
      }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const sentryHealthCheck = createSentryHealthCheck()
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd packages/observability && yarn test sentry-health
```

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/lib/health/sentry.ts packages/observability/src/modules/observability/__tests__/sentry-health.test.ts
git commit -m "feat(observability): Sentry health check"
```

---

## Phase 4 — Langfuse + AI Tracer

### Task 13: Add `llmTracer` no-op default to ai-assistant DI (TDD)

**Files:**
- Modify: `packages/ai-assistant/src/modules/ai_assistant/di.ts`
- Create: `packages/ai-assistant/src/modules/ai_assistant/lib/llm-tracer-types.ts`
- Test: `packages/ai-assistant/src/modules/ai_assistant/__tests__/llm-tracer.test.ts`

- [ ] **Step 1: Read existing di.ts**

Run: `cat packages/ai-assistant/src/modules/ai_assistant/di.ts`

Identify the `register(container)` function.

- [ ] **Step 2: Write interface types**

```ts
// lib/llm-tracer-types.ts
export type LLMTraceInput = {
  name: string
  input: unknown
  metadata?: Record<string, unknown>
  userId?: string
  tenantId?: string
}

export type LLMTraceContext = {
  recordGeneration(opts: {
    name: string
    model?: string
    input: unknown
    output?: unknown
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  }): void
}

export interface LLMTracer {
  traceLLM<T>(opts: LLMTraceInput, fn: (ctx: LLMTraceContext) => Promise<T>): Promise<T>
}

export const noopTracer: LLMTracer = {
  async traceLLM(_opts, fn) {
    const ctx: LLMTraceContext = { recordGeneration: () => undefined }
    return fn(ctx)
  },
}
```

- [ ] **Step 3: Write failing test**

```ts
// __tests__/llm-tracer.test.ts
import { noopTracer } from '../lib/llm-tracer-types'

describe('noopTracer', () => {
  it('invokes fn and returns its result', async () => {
    const result = await noopTracer.traceLLM({ name: 'x', input: {} }, async (ctx) => {
      ctx.recordGeneration({ name: 'gen', input: {} })
      return 42
    })
    expect(result).toBe(42)
  })

  it('propagates errors', async () => {
    await expect(
      noopTracer.traceLLM({ name: 'x', input: {} }, async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 4: Run — expect PASS immediately** (no-op tracer is already exported)

```bash
cd packages/ai-assistant && yarn test llm-tracer
```

- [ ] **Step 5: Register `llmTracer` in ai-assistant DI**

In `packages/ai-assistant/src/modules/ai_assistant/di.ts`, inside `register(container)`, add:

```ts
import { asValue } from 'awilix'
import { noopTracer } from './lib/llm-tracer-types'

// ... existing code ...

container.register({
  llmTracer: asValue(noopTracer),
})
```

If the file already calls `container.register({...})`, merge the `llmTracer` key into that single call.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-assistant/src/modules/ai_assistant/di.ts packages/ai-assistant/src/modules/ai_assistant/lib/llm-tracer-types.ts packages/ai-assistant/src/modules/ai_assistant/__tests__/llm-tracer.test.ts
git commit -m "feat(ai-assistant): add llmTracer DI token with no-op default"
```

---

### Task 14: Wrap ai-assistant LLM call sites with `traceLLM`

**Files:**
- Modify: each file in `packages/ai-assistant/src/modules/ai_assistant/**/*.ts` that calls an LLM provider SDK directly

- [ ] **Step 1: Find call sites**

```bash
grep -rn "anthropic\.\(messages\|complete\)\|openai\.\(chat\|complete\)\|generateText\|streamText" packages/ai-assistant/src --include='*.ts' --include='*.tsx'
```

Record each match location.

- [ ] **Step 2: For each call site, wrap the call**

For a call site like:

```ts
const response = await client.messages.create({ model, messages, ... })
```

Transform to:

```ts
import type { LLMTracer } from '../../lib/llm-tracer-types'

const tracer = container.resolve<LLMTracer>('llmTracer')
const response = await tracer.traceLLM(
  { name: 'ai-assistant.<command>', input: { messages }, tenantId, userId },
  async (ctx) => {
    const res = await client.messages.create({ model, messages, ... })
    ctx.recordGeneration({ name: 'claude', model, input: messages, output: res, usage: { promptTokens: res.usage?.input_tokens, completionTokens: res.usage?.output_tokens } })
    return res
  }
)
```

Keep the existing behavior identical — the no-op tracer passes through unchanged.

- [ ] **Step 3: Build and test**

```bash
yarn build:packages
yarn test --filter=@open-mercato/ai-assistant
```

Expected: all existing ai-assistant tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/ai-assistant
git commit -m "feat(ai-assistant): wrap LLM calls with llmTracer"
```

---

### Task 15: Langfuse client factory + tracer implementation + health check

**Files:**
- Create: `packages/observability/src/modules/observability/lib/langfuse-client.ts`
- Create: `packages/observability/src/modules/observability/lib/llm-tracer.ts`
- Create: `packages/observability/src/modules/observability/lib/health/langfuse.ts`
- Test: `packages/observability/src/modules/observability/__tests__/llm-tracer.test.ts`

- [ ] **Step 1: Write `lib/langfuse-client.ts`**

```ts
import { Langfuse } from 'langfuse'
import type { LangfuseCredentials } from '../data/validators'

const clients = new Map<string, Langfuse>()

export function getLangfuseClient(tenantId: string, creds: LangfuseCredentials): Langfuse {
  const key = `${tenantId}:${creds.host}:${creds.publicKey}`
  const existing = clients.get(key)
  if (existing) return existing
  const client = new Langfuse({ publicKey: creds.publicKey, secretKey: creds.secretKey, baseUrl: creds.host })
  clients.set(key, client)
  return client
}

export async function flushLangfuseClients(): Promise<void> {
  await Promise.all(Array.from(clients.values()).map((c) => c.flushAsync()))
}
```

- [ ] **Step 2: Write failing test**

```ts
// __tests__/llm-tracer.test.ts
import { createLangfuseTracer } from '../lib/llm-tracer'

describe('langfuse tracer', () => {
  it('creates a trace and records a generation', async () => {
    const updateMock = jest.fn()
    const generationMock = jest.fn(() => ({ end: jest.fn(), update: jest.fn() }))
    const trace = { update: updateMock, generation: generationMock }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    const result = await tracer.traceLLM({ name: 'test', input: { q: 1 } }, async (ctx) => {
      ctx.recordGeneration({ name: 'gen', model: 'claude', input: { q: 1 }, output: 'ok' })
      return 'done'
    })

    expect(result).toBe('done')
    expect(client.trace).toHaveBeenCalledWith(expect.objectContaining({ name: 'test' }))
    expect(generationMock).toHaveBeenCalled()
  })

  it('scrubs sensitive fields from input', async () => {
    const generationMock = jest.fn(() => ({ end: jest.fn(), update: jest.fn() }))
    const trace = { update: jest.fn(), generation: generationMock }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    await tracer.traceLLM({ name: 'test', input: { password: 'nope', q: 1 } }, async () => 'x')

    expect(client.trace).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ password: '[REDACTED]' }) })
    )
  })

  it('records an error and rethrows', async () => {
    const updateMock = jest.fn()
    const trace = { update: updateMock, generation: jest.fn() }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    await expect(
      tracer.traceLLM({ name: 'test', input: {} }, async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'ERROR' }))
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd packages/observability && yarn test llm-tracer
```

- [ ] **Step 4: Write `lib/llm-tracer.ts`**

```ts
import type { LLMTracer, LLMTraceContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-tracer-types'
import { scrub } from './redaction'

type LangfuseLike = {
  trace(opts: { name: string; input: unknown; userId?: string; metadata?: Record<string, unknown> }): {
    update(opts: Record<string, unknown>): void
    generation(opts: {
      name: string
      model?: string
      input: unknown
      output?: unknown
      usage?: Record<string, unknown>
    }): { end(): void; update(opts: Record<string, unknown>): void }
  }
}

type ClientFactory = () => LangfuseLike

export function createLangfuseTracer(factory: ClientFactory): LLMTracer {
  return {
    async traceLLM(opts, fn) {
      const client = factory()
      const trace = client.trace({
        name: opts.name,
        input: scrub(opts.input),
        userId: opts.userId,
        metadata: {
          ...(opts.metadata ?? {}),
          tenantId: opts.tenantId,
        },
      })
      const ctx: LLMTraceContext = {
        recordGeneration(gen) {
          trace.generation({
            name: gen.name,
            model: gen.model,
            input: scrub(gen.input),
            output: scrub(gen.output),
            usage: gen.usage,
          }).end()
        },
      }
      try {
        const result = await fn(ctx)
        trace.update({ output: scrub(result) })
        return result
      } catch (err) {
        trace.update({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
        throw err
      }
    },
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd packages/observability && yarn test llm-tracer
```

- [ ] **Step 6: Write Langfuse health check**

```ts
// lib/health/langfuse.ts
import type { LangfuseCredentials } from '../../data/validators'

type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createLangfuseHealthCheck(deps: Deps = { fetch }) {
  return async function langfuseHealthCheck(creds: LangfuseCredentials): Promise<HealthResult> {
    try {
      const url = `${creds.host.replace(/\/$/, '')}/api/public/health`
      const res = await deps.fetch(url, {
        method: 'GET',
        headers: { authorization: `Basic ${Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64')}` },
      })
      if (!res.ok) return { status: 'unhealthy', message: `Langfuse returned HTTP ${res.status}` }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const langfuseHealthCheck = createLangfuseHealthCheck()
```

- [ ] **Step 7: Commit**

```bash
git add packages/observability/src/modules/observability/lib/langfuse-client.ts packages/observability/src/modules/observability/lib/llm-tracer.ts packages/observability/src/modules/observability/lib/health/langfuse.ts packages/observability/src/modules/observability/__tests__/llm-tracer.test.ts
git commit -m "feat(observability): Langfuse client, tracer impl, and health check"
```

---

### Task 16: Observability `di.ts` — register services and override `llmTracer`

**Files:**
- Create: `packages/observability/src/modules/observability/di.ts`
- Create: `packages/observability/src/modules/observability/events.ts`

- [ ] **Step 1: Write `events.ts` (minimal — required by module contract)**

```ts
export const eventsConfig = {} as const
```

- [ ] **Step 2: Write `di.ts`**

```ts
import { asFunction, asValue, type AwilixContainer } from 'awilix'
import { createTenantConfigResolver } from './lib/tenant-config'
import { getLangfuseClient } from './lib/langfuse-client'
import { getPosthogClient } from './lib/posthog-client'
import { createLangfuseTracer } from './lib/llm-tracer'
import { noopTracer } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-tracer-types'
import { posthogHealthCheck } from './lib/health/posthog'
import { langfuseHealthCheck } from './lib/health/langfuse'
import { sentryHealthCheck } from './lib/health/sentry'
import { withTenantScope, sentryInitialized } from './lib/sentry-server'

export function register(container: AwilixContainer) {
  container.register({
    observabilityTenantConfig: asFunction(
      ({ integrationCredentialsService, integrationStateService }) =>
        createTenantConfigResolver({
          credentialsService: integrationCredentialsService,
          stateService: integrationStateService,
        })
    ).singleton(),

    posthogClientFactory: asValue(getPosthogClient),
    langfuseClientFactory: asValue(getLangfuseClient),

    sentryScopeHelper: asValue({ withTenantScope, isInitialized: sentryInitialized }),

    llmTracer: asFunction(({ observabilityTenantConfig, langfuseClientFactory }) => {
      return {
        async traceLLM(opts: any, fn: any) {
          if (!opts.tenantId) return noopTracer.traceLLM(opts, fn)
          const cfg = (await observabilityTenantConfig.get(opts.tenantId)).langfuse
          if (!cfg) return noopTracer.traceLLM(opts, fn)
          const tracer = createLangfuseTracer(() => langfuseClientFactory(opts.tenantId, cfg))
          return tracer.traceLLM(opts, fn)
        },
      }
    }).singleton(),

    posthogHealthCheck: asValue(posthogHealthCheck),
    langfuseHealthCheck: asValue(langfuseHealthCheck),
    sentryHealthCheck: asValue(sentryHealthCheck),
  })

  // Cache invalidation on integration events
  const events = container.resolve<any>('eventBus')
  events.on('integrations.credentials.updated', async (evt: any) => {
    if (evt.tenantId) container.resolve<any>('observabilityTenantConfig').invalidate(evt.tenantId)
  })
  events.on('integrations.state.updated', async (evt: any) => {
    if (evt.tenantId) container.resolve<any>('observabilityTenantConfig').invalidate(evt.tenantId)
  })
}
```

- [ ] **Step 3: Build and verify DI registration works**

```bash
yarn build:packages --filter=@open-mercato/observability
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/observability/src/modules/observability/di.ts packages/observability/src/modules/observability/events.ts
git commit -m "feat(observability): DI registration overrides llmTracer when Langfuse enabled"
```

---

## Phase 5 — Client Config + Browser Bootstrap

### Task 17: `GET /api/observability/client-config` endpoint

**Files:**
- Create: `packages/observability/src/modules/observability/api/get/observability/client-config.ts`
- Test: `packages/observability/src/modules/observability/__tests__/client-config.test.ts`

- [ ] **Step 1: Inspect reference API route shape**

Run: `cat packages/core/src/modules/integrations/api/route.ts | head -60` to confirm the export shape (handler signature, `openApi` export).

- [ ] **Step 2: Write route**

```ts
// api/get/observability/client-config.ts
import type { NextRequest } from 'next/server'

export const openApi = {
  summary: 'Get browser-safe observability configuration for the current tenant',
  responses: {
    200: {
      description: 'Merged enabled-provider config',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              posthog: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', properties: { enabled: { type: 'boolean' }, key: { type: 'string' }, host: { type: 'string' }, sessionRecording: { type: 'boolean' } } },
                ],
              },
              sentry: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', properties: { enabled: { type: 'boolean' }, dsn: { type: 'string' }, environment: { type: 'string' }, tracesSampleRate: { type: 'number' } } },
                ],
              },
              langfuse: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', properties: { enabled: { type: 'boolean' } } },
                ],
              },
            },
          },
        },
      },
    },
  },
}

export async function GET(req: NextRequest) {
  const container = (req as any).container
  const auth = (req as any).auth
  const tenantId = auth?.tenantId
  if (!tenantId) return new Response(JSON.stringify({ posthog: null, sentry: null, langfuse: null }), { status: 200, headers: { 'content-type': 'application/json' } })
  const resolver = container.resolve('observabilityTenantConfig')
  const cfg = await resolver.get(tenantId)
  const body = {
    posthog: cfg.posthog ? { enabled: true, key: cfg.posthog.projectKey, host: cfg.posthog.host, sessionRecording: cfg.posthog.sessionRecording ?? false } : null,
    sentry: cfg.sentry ? { enabled: true, dsn: cfg.sentry.dsn, environment: cfg.sentry.environment, tracesSampleRate: cfg.sentry.tracesSampleRate } : null,
    langfuse: cfg.langfuse ? { enabled: true } : null,
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' } })
}
```

Note: the handler shape must match the host app's convention. If `(req as any).container` / `(req as any).auth` is not how open-mercato passes context, adapt based on the inspected reference file. Keep the semantic: tenant from request auth; resolver lookup; never return secret-grade fields that aren't in the browser-safe list above.

- [ ] **Step 3: Write test**

```ts
// __tests__/client-config.test.ts
import { GET } from '../api/get/observability/client-config'

function makeReq(tenantId: string | undefined, cfg: any) {
  const container = { resolve: () => ({ get: async () => cfg }) }
  return { container, auth: { tenantId } } as any
}

describe('GET /api/observability/client-config', () => {
  it('returns nulls when tenant absent', async () => {
    const res = await GET(makeReq(undefined, {}) as any)
    expect(await res.json()).toEqual({ posthog: null, sentry: null, langfuse: null })
  })

  it('omits Langfuse secret key from payload', async () => {
    const cfg = {
      posthog: null,
      sentry: null,
      langfuse: { publicKey: 'pk', secretKey: 'SECRET', host: 'https://cloud.langfuse.com' },
    }
    const body = await (await GET(makeReq('t-1', cfg) as any)).json()
    expect(JSON.stringify(body)).not.toContain('SECRET')
    expect(body.langfuse).toEqual({ enabled: true })
  })

  it('returns merged enabled config', async () => {
    const cfg = {
      posthog: { projectKey: 'phc_x', host: 'https://us.i.posthog.com', sessionRecording: true },
      sentry: { dsn: 'https://abc@sentry.io/1', environment: 'prod', tracesSampleRate: 0.25 },
      langfuse: null,
    }
    const body = await (await GET(makeReq('t-1', cfg) as any)).json()
    expect(body.posthog).toEqual({ enabled: true, key: 'phc_x', host: 'https://us.i.posthog.com', sessionRecording: true })
    expect(body.sentry).toEqual({ enabled: true, dsn: 'https://abc@sentry.io/1', environment: 'prod', tracesSampleRate: 0.25 })
    expect(body.langfuse).toBeNull()
  })
})
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd packages/observability && yarn test client-config
```

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/api/get/observability/client-config.ts packages/observability/src/modules/observability/__tests__/client-config.test.ts
git commit -m "feat(observability): client-config API endpoint"
```

---

### Task 18: Admin shell wrapper widget (PostHog + Sentry browser bootstrap)

**Files:**
- Create: `packages/observability/src/modules/observability/widgets/injection/admin-shell/widget.client.tsx`
- Create: `packages/observability/src/modules/observability/widgets/injection-table.ts`

- [ ] **Step 1: Inspect admin shell injection spot ID**

Run: `grep -rn "admin-shell\|admin:shell\|shell:admin" packages/ui/src/backend --include='*.ts' --include='*.tsx' | head -20`

Record the exact spot ID constant/string used by the admin shell.

- [ ] **Step 2: Write widget**

```tsx
// widgets/injection/admin-shell/widget.client.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

type ClientConfig = {
  posthog: { enabled: boolean; key: string; host: string; sessionRecording?: boolean } | null
  sentry: { enabled: boolean; dsn: string; environment?: string; tracesSampleRate?: number } | null
  langfuse: { enabled: boolean } | null
}

async function fetchConfig(): Promise<ClientConfig> {
  const res = await fetch('/api/observability/client-config', { credentials: 'include' })
  if (!res.ok) return { posthog: null, sentry: null, langfuse: null }
  return res.json()
}

export default function AdminShellObservability({ children }: { children: React.ReactNode }) {
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void (async () => {
      const cfg = await fetchConfig()
      if (cfg.posthog?.enabled) {
        const { default: posthog } = await import('posthog-js')
        posthog.init(cfg.posthog.key, {
          api_host: cfg.posthog.host,
          autocapture: true,
          session_recording: { enabled: cfg.posthog.sessionRecording ?? false },
          person_profiles: 'identified_only',
        })
      }
      if (cfg.sentry?.enabled) {
        const Sentry = await import('@sentry/browser')
        Sentry.init({
          dsn: cfg.sentry.dsn,
          environment: cfg.sentry.environment,
          tracesSampleRate: cfg.sentry.tracesSampleRate ?? 0.1,
        })
      }
    })()
  }, [])
  return <>{children}</>
}
```

- [ ] **Step 3: Write `widgets/injection-table.ts`**

```ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import AdminShellObservability from './injection/admin-shell/widget.client'
import PortalShellObservability from './injection/portal-shell/widget.client'

export const widgets = [
  {
    id: 'observability.admin-shell',
    spot: 'admin-shell:root',     // replace with actual admin shell spot id from Step 1
    position: InjectionPosition.Wrap,
    component: AdminShellObservability,
  },
  {
    id: 'observability.portal-shell',
    spot: 'portal-shell:root',    // replace with actual portal shell spot id
    position: InjectionPosition.Wrap,
    component: PortalShellObservability,
  },
]
```

If the correct spot IDs are different names, substitute them.

- [ ] **Step 4: Commit**

```bash
git add packages/observability/src/modules/observability/widgets
git commit -m "feat(observability): admin shell browser bootstrap widget"
```

---

### Task 19: Portal shell wrapper widget

**Files:**
- Create: `packages/observability/src/modules/observability/widgets/injection/portal-shell/widget.client.tsx`

- [ ] **Step 1: Write widget**

```tsx
// widgets/injection/portal-shell/widget.client.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

type ClientConfig = {
  posthog: { enabled: boolean; key: string; host: string; sessionRecording?: boolean } | null
  sentry: { enabled: boolean; dsn: string; environment?: string; tracesSampleRate?: number } | null
}

async function fetchConfig(): Promise<ClientConfig> {
  const res = await fetch('/api/observability/client-config', { credentials: 'include' })
  if (!res.ok) return { posthog: null, sentry: null } as ClientConfig
  return res.json()
}

export default function PortalShellObservability({ children }: { children: React.ReactNode }) {
  const initRef = useRef(false)
  const auth = useCustomerAuth()
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void (async () => {
      const cfg = await fetchConfig()
      if (cfg.posthog?.enabled) {
        const { default: posthog } = await import('posthog-js')
        posthog.init(cfg.posthog.key, {
          api_host: cfg.posthog.host,
          autocapture: true,
          session_recording: { enabled: cfg.posthog.sessionRecording ?? false },
          person_profiles: 'identified_only',
        })
        if (auth?.customer?.id) posthog.identify(auth.customer.id)
      }
      if (cfg.sentry?.enabled) {
        const Sentry = await import('@sentry/browser')
        Sentry.init({
          dsn: cfg.sentry.dsn,
          environment: cfg.sentry.environment,
          tracesSampleRate: cfg.sentry.tracesSampleRate ?? 0.1,
        })
        if (auth?.customer?.id) Sentry.setUser({ id: auth.customer.id })
      }
    })()
  }, [auth?.customer?.id])
  return <>{children}</>
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/observability/src/modules/observability/widgets/injection/portal-shell/widget.client.tsx
git commit -m "feat(observability): portal shell browser bootstrap widget"
```

---

## Phase 6 — Env Preset + CLI + i18n + Setup

### Task 20: Env preset helper (TDD)

**Files:**
- Create: `packages/observability/src/modules/observability/lib/preset.ts`
- Test: `packages/observability/src/modules/observability/__tests__/preset.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/preset.test.ts
import { readPresetFromEnv } from '../lib/preset'

describe('readPresetFromEnv', () => {
  it('returns null sections when env vars missing', () => {
    const p = readPresetFromEnv({})
    expect(p).toEqual({ posthog: null, langfuse: null, sentry: null })
  })

  it('parses posthog preset when key is set', () => {
    const p = readPresetFromEnv({
      OM_INTEGRATION_POSTHOG_PROJECT_KEY: 'phc_abc',
      OM_INTEGRATION_POSTHOG_HOST: 'https://eu.i.posthog.com',
    })
    expect(p.posthog).toEqual({ projectKey: 'phc_abc', host: 'https://eu.i.posthog.com' })
  })

  it('rejects partial langfuse credentials', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_LANGFUSE_PUBLIC_KEY: 'pk' })
    expect(p.langfuse).toBeNull()
  })

  it('parses sentry DSN-only preset', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_SENTRY_DSN: 'https://abc@sentry.io/1' })
    expect(p.sentry).toEqual({ dsn: 'https://abc@sentry.io/1' })
  })

  it('applies default hosts', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_POSTHOG_PROJECT_KEY: 'phc_x' })
    expect(p.posthog?.host).toBe('https://us.i.posthog.com')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/observability && yarn test preset
```

- [ ] **Step 3: Write implementation**

```ts
// lib/preset.ts
import type { PosthogCredentials, LangfuseCredentials, SentryCredentials } from '../data/validators'

export type PresetOutput = {
  posthog: Partial<PosthogCredentials> | null
  langfuse: Partial<LangfuseCredentials> | null
  sentry: Partial<SentryCredentials> | null
}

export function readPresetFromEnv(env: Record<string, string | undefined>): PresetOutput {
  const posthogKey = env.OM_INTEGRATION_POSTHOG_PROJECT_KEY
  const posthog = posthogKey
    ? { projectKey: posthogKey, host: env.OM_INTEGRATION_POSTHOG_HOST ?? 'https://us.i.posthog.com' }
    : null

  const lfPub = env.OM_INTEGRATION_LANGFUSE_PUBLIC_KEY
  const lfSec = env.OM_INTEGRATION_LANGFUSE_SECRET_KEY
  const langfuse = lfPub && lfSec
    ? { publicKey: lfPub, secretKey: lfSec, host: env.OM_INTEGRATION_LANGFUSE_HOST ?? 'https://cloud.langfuse.com' }
    : null

  const dsn = env.OM_INTEGRATION_SENTRY_DSN
  const sentry = dsn
    ? {
        dsn,
        environment: env.OM_INTEGRATION_SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: env.OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE
          ? Number(env.OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE)
          : 0.1,
      }
    : null

  return { posthog, langfuse, sentry }
}

type ApplyDeps = {
  credentialsService: {
    upsert: (args: { integrationId: string; tenantId: string; data: unknown }) => Promise<void>
  }
  stateService: {
    upsert: (args: { integrationId: string; tenantId: string; enabled: boolean }) => Promise<void>
  }
}

export async function applyPreset(deps: ApplyDeps, tenantId: string, preset: PresetOutput): Promise<void> {
  if (preset.posthog) {
    await deps.credentialsService.upsert({ integrationId: 'observability_posthog', tenantId, data: preset.posthog })
    await deps.stateService.upsert({ integrationId: 'observability_posthog', tenantId, enabled: true })
  }
  if (preset.langfuse) {
    await deps.credentialsService.upsert({ integrationId: 'observability_langfuse', tenantId, data: preset.langfuse })
    await deps.stateService.upsert({ integrationId: 'observability_langfuse', tenantId, enabled: true })
  }
  if (preset.sentry) {
    await deps.credentialsService.upsert({ integrationId: 'observability_sentry', tenantId, data: preset.sentry })
    await deps.stateService.upsert({ integrationId: 'observability_sentry', tenantId, enabled: true })
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd packages/observability && yarn test preset
```

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/modules/observability/lib/preset.ts packages/observability/src/modules/observability/__tests__/preset.test.ts
git commit -m "feat(observability): env preset parser with apply helper"
```

---

### Task 21: `setup.ts` — default role features + preset hook

**Files:**
- Create: `packages/observability/src/modules/observability/setup.ts`

- [ ] **Step 1: Inspect reference**

Run: `cat packages/gateway-stripe/src/modules/gateway_stripe/setup.ts`

Note the `ModuleSetupConfig` shape used: `defaultRoleFeatures`, `onTenantCreated`, etc.

- [ ] **Step 2: Write `setup.ts`**

```ts
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { readPresetFromEnv, applyPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['observability.view', 'observability.manage', 'observability.credentials.manage'],
    'tenant-admin': ['observability.view', 'observability.manage', 'observability.credentials.manage'],
  },
  async onTenantCreated(ctx) {
    const preset = readPresetFromEnv(process.env as Record<string, string | undefined>)
    const hasAny = preset.posthog || preset.langfuse || preset.sentry
    if (!hasAny) return
    await applyPreset(
      {
        credentialsService: ctx.container.resolve('integrationCredentialsService'),
        stateService: ctx.container.resolve('integrationStateService'),
      },
      ctx.tenantId,
      preset
    )
  },
}

export default setup
```

If `ModuleSetupConfig` shape differs, adapt based on the reference. Keep semantics: apply preset only when one or more env blocks are fully populated.

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/setup.ts
git commit -m "feat(observability): setup config with default role features and preset hook"
```

---

### Task 22: CLI — `configure-from-env` and `test-capture` commands

**Files:**
- Create: `packages/observability/src/modules/observability/cli.ts`

- [ ] **Step 1: Inspect reference**

Run: `cat packages/gateway-stripe/src/modules/gateway_stripe/cli.ts`

- [ ] **Step 2: Write CLI**

```ts
import { readPresetFromEnv, applyPreset } from './lib/preset'

export default {
  name: 'observability',
  commands: {
    'configure-from-env': {
      description: 'Re-apply observability credentials from OM_INTEGRATION_* env vars for a given tenant.',
      args: [{ name: 'tenantId', required: true }],
      async run(args: { tenantId: string }, ctx: { container: any }) {
        const preset = readPresetFromEnv(process.env as Record<string, string | undefined>)
        await applyPreset(
          {
            credentialsService: ctx.container.resolve('integrationCredentialsService'),
            stateService: ctx.container.resolve('integrationStateService'),
          },
          args.tenantId,
          preset
        )
        const applied: string[] = []
        if (preset.posthog) applied.push('posthog')
        if (preset.langfuse) applied.push('langfuse')
        if (preset.sentry) applied.push('sentry')
        console.log(`Applied: ${applied.join(', ') || '(none)'}`)
      },
    },
    'test-capture': {
      description: 'Emit a synthetic event to verify PostHog forwarding for a tenant.',
      args: [{ name: 'tenantId', required: true }],
      async run(args: { tenantId: string }, ctx: { container: any }) {
        const resolver = ctx.container.resolve('observabilityTenantConfig')
        const cfg = (await resolver.get(args.tenantId)).posthog
        if (!cfg) {
          console.log('PostHog not enabled for this tenant.')
          return
        }
        const factory = ctx.container.resolve('posthogClientFactory')
        const client = factory(args.tenantId, cfg)
        client.capture({
          distinctId: `tenant:${args.tenantId}:cli-test`,
          event: 'observability.cli.test',
          properties: { source: 'cli', timestamp: new Date().toISOString() },
          groups: { tenant: args.tenantId },
        })
        await client.flush()
        console.log('Test event captured.')
      },
    },
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/cli.ts
git commit -m "feat(observability): CLI commands configure-from-env and test-capture"
```

---

### Task 23: i18n files

**Files:**
- Create: `packages/observability/src/modules/observability/i18n/en.ts`
- Create: `packages/observability/src/modules/observability/i18n/pl.ts`

- [ ] **Step 1: Write EN**

```ts
export default {
  module: { title: 'Observability', description: 'Product analytics, LLM tracing, and error monitoring.' },
  features: {
    'observability.view': 'View observability integrations',
    'observability.manage': 'Manage observability integrations',
    'observability.credentials.manage': 'Manage observability credentials',
  },
  providers: {
    posthog: { title: 'PostHog', description: 'Product analytics with session replay.' },
    langfuse: { title: 'Langfuse', description: 'LLM observability for AI workflows.' },
    sentry: { title: 'Sentry', description: 'Error and performance monitoring.' },
  },
}
```

- [ ] **Step 2: Write PL (translate strings)**

```ts
export default {
  module: { title: 'Obserwowalność', description: 'Analityka produktowa, śledzenie LLM i monitoring błędów.' },
  features: {
    'observability.view': 'Przeglądanie integracji obserwowalności',
    'observability.manage': 'Zarządzanie integracjami obserwowalności',
    'observability.credentials.manage': 'Zarządzanie poświadczeniami obserwowalności',
  },
  providers: {
    posthog: { title: 'PostHog', description: 'Analityka produktowa z nagrywaniem sesji.' },
    langfuse: { title: 'Langfuse', description: 'Obserwowalność LLM dla przepływów AI.' },
    sentry: { title: 'Sentry', description: 'Monitoring błędów i wydajności.' },
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/i18n
git commit -m "feat(observability): i18n strings (en, pl)"
```

---

### Task 24: README.md + RELEASE_NOTES entry

**Files:**
- Create: `packages/observability/README.md`
- Modify: `RELEASE_NOTES.md`

- [ ] **Step 1: Write `packages/observability/README.md`**

```markdown
# @open-mercato/observability

Product analytics (PostHog), LLM tracing (Langfuse), and error monitoring (Sentry) as open-mercato Integration Marketplace providers. Works against cloud or self-hosted deployments of all three tools.

## Installation

Included in the mercato app by default. Register in your custom app via `apps/<app>/src/modules.ts`:

```ts
export const modules = [
  // ...
  '@open-mercato/observability',
]
```

## Configuration

### Via admin UI
Navigate to `/backend/integrations`, pick PostHog, Langfuse, or Sentry, fill in credentials, and enable.

### Via environment variables

| Variable | Purpose | Default |
|---|---|---|
| `OM_INTEGRATION_POSTHOG_PROJECT_KEY` | PostHog project API key | — |
| `OM_INTEGRATION_POSTHOG_HOST` | PostHog host (cloud or self-hosted) | `https://us.i.posthog.com` |
| `OM_INTEGRATION_LANGFUSE_PUBLIC_KEY` | Langfuse public key | — |
| `OM_INTEGRATION_LANGFUSE_SECRET_KEY` | Langfuse secret key | — |
| `OM_INTEGRATION_LANGFUSE_HOST` | Langfuse host | `https://cloud.langfuse.com` |
| `OM_INTEGRATION_SENTRY_DSN` | Sentry DSN (encodes host) | — |
| `OM_INTEGRATION_SENTRY_ENVIRONMENT` | Sentry environment tag | `NODE_ENV` |
| `OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE` | Transaction sample rate | `0.1` |

Env variables apply on tenant bootstrap and can be re-applied with:

```bash
yarn cli observability configure-from-env <tenantId>
```

### Self-hosted deployments
All three providers accept a host/DSN pointing at your self-hosted deployment — no code change required. Set the `host` credential (PostHog, Langfuse) or the DSN domain (Sentry) accordingly.

## Data forwarded

### PostHog
A wildcard subscriber forwards tenant-scoped events matching the default allowlist:
- `auth.user.loggedIn`
- `sales.order.created`
- `sales.quote.accepted`
- `catalog.product.created`
- `customers.person.created`
- `integrations.state.updated`
- `workflows.instance.completed`

Default denylist blocks events with substrings `credentials`, `secret`, `password`, `integrations.log`.

Customize per-tenant by editing the integration's `config` (`allowlist: string[]`, `denylist: string[]`, `redactionKeys: string[]`).

### Langfuse
Traces all LLM calls made by the open-mercato AI assistant. Each trace records input, output, tokens, latency, model, and tenant/user metadata.

### Sentry
Captures server and browser errors/performance. Server DSN is process-global (see multi-tenant caveat below). Browser DSN is per-tenant via `/api/observability/client-config`.

## Security

- All credentials encrypted at rest via the integrations module's encryption service.
- All forwarded payloads pass through a PII scrubber (keys matching `password|secret|token|apiKey|privateKey|authorization|cookie|sessionId|creditCard|cvv|ssn|dsn` → `[REDACTED]`).
- Strings larger than 8KB are truncated before forwarding.
- Opt-in redaction of additional keys per tenant via `redactionKeys`.

## Multi-tenant Sentry caveat

Sentry's Node SDK is process-global. For multi-tenant SaaS deployments:
- Preferred: run separate Sentry projects per tenant with a reverse proxy.
- Acceptable: use a single project and filter by the `tenant_id` tag (automatically applied to every error).
- Browser-side Sentry is always per-tenant.

## Testing

```bash
cd packages/observability && yarn test
```
```

- [ ] **Step 2: Append to `RELEASE_NOTES.md`**

Add under the current unreleased section (create one if missing):

```markdown
### Added
- `@open-mercato/observability` package — PostHog, Langfuse, and Sentry as Integration Marketplace providers with cloud/self-hosted parity. Includes server event forwarding, admin+portal browser instrumentation, LLM tracing for the AI assistant via an additive `llmTracer` DI token, env-preset bootstrap, and per-tenant PII scrubbing.
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/README.md RELEASE_NOTES.md
git commit -m "docs(observability): README and release notes"
```

---

## Phase 7 — Integration Tests

### Task 25: Integration test scaffold and lifecycle tests

**Files:**
- Create: `packages/observability/src/modules/observability/__integration__/lifecycle.spec.ts`

- [ ] **Step 1: Inspect reference integration test**

Run: `ls packages/core/src/modules/integrations/__integration__/ && cat packages/core/src/modules/integrations/__integration__/*.spec.ts | head -40`

Note the helper imports and fixture pattern.

- [ ] **Step 2: Write lifecycle test**

```ts
// __integration__/lifecycle.spec.ts
import { test, expect } from '@playwright/test'
import { createTestTenant, cleanupTenant, apiClient } from '@open-mercato/core/modules/core/__integration__/helpers'

test.describe('observability lifecycle', () => {
  let tenantId: string
  let client: ReturnType<typeof apiClient>

  test.beforeAll(async () => {
    tenantId = await createTestTenant()
    client = apiClient({ tenantId })
  })

  test.afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  test('lists three observability integrations', async () => {
    const res = await client.get('/api/integrations')
    const ids = res.data.items.map((i: any) => i.id)
    expect(ids).toContain('observability_posthog')
    expect(ids).toContain('observability_langfuse')
    expect(ids).toContain('observability_sentry')
  })

  test('saves and retrieves PostHog credentials', async () => {
    await client.put('/api/integrations/observability_posthog/credentials', {
      data: { projectKey: 'phc_test', host: 'https://localhost:4000' },
    })
    await client.put('/api/integrations/observability_posthog/state', { enabled: true })
    const cfg = await client.get('/api/observability/client-config')
    expect(cfg.data.posthog).toEqual(expect.objectContaining({ enabled: true, key: 'phc_test' }))
  })

  test('client-config omits Langfuse secret key', async () => {
    await client.put('/api/integrations/observability_langfuse/credentials', {
      data: { publicKey: 'pk_test', secretKey: 'SECRET_NEVER_LEAKS', host: 'http://localhost:3000' },
    })
    await client.put('/api/integrations/observability_langfuse/state', { enabled: true })
    const res = await client.get('/api/observability/client-config')
    expect(JSON.stringify(res.data)).not.toContain('SECRET_NEVER_LEAKS')
    expect(res.data.langfuse).toEqual({ enabled: true })
  })

  test('health check transitions state', async () => {
    const res = await client.post('/api/integrations/observability_sentry/health', {})
    expect(['healthy', 'unhealthy']).toContain(res.data.status)
  })

  test('returns nulls when all disabled', async () => {
    await client.put('/api/integrations/observability_posthog/state', { enabled: false })
    await client.put('/api/integrations/observability_langfuse/state', { enabled: false })
    await client.put('/api/integrations/observability_sentry/state', { enabled: false })
    const res = await client.get('/api/observability/client-config')
    expect(res.data).toEqual({ posthog: null, sentry: null, langfuse: null })
  })
})
```

Adapt the helper import paths and method shapes to match existing fixtures under `packages/core/src/modules/core/__integration__/helpers/`.

- [ ] **Step 3: Run**

```bash
yarn test:integration --grep="observability lifecycle"
```

Expected: all tests pass. Fix any helper signature mismatches.

- [ ] **Step 4: Commit**

```bash
git add packages/observability/src/modules/observability/__integration__
git commit -m "test(observability): lifecycle integration tests"
```

---

### Task 26: Event-forwarding integration test with mock PostHog endpoint

**Files:**
- Create: `packages/observability/src/modules/observability/__integration__/event-forwarding.spec.ts`

- [ ] **Step 1: Write test**

```ts
// __integration__/event-forwarding.spec.ts
import { test, expect } from '@playwright/test'
import http from 'http'
import { createTestTenant, cleanupTenant, apiClient, emitTestEvent } from '@open-mercato/core/modules/core/__integration__/helpers'

test.describe('observability event forwarding', () => {
  let tenantId: string
  let client: ReturnType<typeof apiClient>
  let captured: any[] = []
  let mockServer: http.Server
  let mockPort: number

  test.beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try { captured.push(JSON.parse(body)) } catch { /* ignore */ }
        res.statusCode = 200
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => mockServer.listen(0, resolve))
    mockPort = (mockServer.address() as any).port

    tenantId = await createTestTenant()
    client = apiClient({ tenantId })
    await client.put('/api/integrations/observability_posthog/credentials', {
      data: { projectKey: 'phc_test', host: `http://127.0.0.1:${mockPort}`, allowlist: ['sales.order.created'], denylist: [] },
    })
    await client.put('/api/integrations/observability_posthog/state', { enabled: true })
  })

  test.afterAll(async () => {
    await cleanupTenant(tenantId)
    await new Promise<void>((resolve) => mockServer.close(() => resolve()))
  })

  test('forwards allowed event to PostHog host', async () => {
    await emitTestEvent({ tenantId, id: 'sales.order.created', payload: { orderId: 'o-1', organizationId: 'org-1', actorUserId: 'u-1' } })
    await new Promise((r) => setTimeout(r, 15_000))   // wait for batcher
    const sent = captured.flatMap((c: any) => c.batch ?? [c])
    const match = sent.find((e: any) => e.event === 'sales.order.created')
    expect(match).toBeTruthy()
    expect(match.distinct_id).toBe('u-1')
    expect(match.properties.tenant_id).toBe(tenantId)
  })

  test('does not forward denied event', async () => {
    captured = []
    await emitTestEvent({ tenantId, id: 'integrations.log.created', payload: {} })
    await new Promise((r) => setTimeout(r, 15_000))
    const sent = captured.flatMap((c: any) => c.batch ?? [c])
    const match = sent.find((e: any) => e.event === 'integrations.log.created')
    expect(match).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run**

```bash
yarn test:integration --grep="observability event forwarding"
```

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/modules/observability/__integration__/event-forwarding.spec.ts
git commit -m "test(observability): event forwarding with mock PostHog"
```

---

### Task 27: AI-assistant decoupling test (works without observability)

**Files:**
- Create: `packages/ai-assistant/src/modules/ai_assistant/__tests__/tracer-decoupling.test.ts`

- [ ] **Step 1: Write test**

```ts
import { noopTracer } from '../lib/llm-tracer-types'

describe('ai-assistant without observability', () => {
  it('noopTracer invokes fn and returns value unchanged', async () => {
    const result = await noopTracer.traceLLM({ name: 't', input: { q: 1 } }, async () => ({ answer: 42 }))
    expect(result).toEqual({ answer: 42 })
  })

  it('noopTracer accepts ctx.recordGeneration calls without side-effects', async () => {
    await noopTracer.traceLLM({ name: 't', input: {} }, async (ctx) => {
      expect(() => ctx.recordGeneration({ name: 'g', input: {}, output: {} })).not.toThrow()
      return 'ok'
    })
  })
})
```

- [ ] **Step 2: Run — expect PASS**

```bash
cd packages/ai-assistant && yarn test tracer-decoupling
```

- [ ] **Step 3: Commit**

```bash
git add packages/ai-assistant/src/modules/ai_assistant/__tests__/tracer-decoupling.test.ts
git commit -m "test(ai-assistant): verify decoupling from observability package"
```

---

## Phase 8 — Final validation and PR

### Task 28: Full validation

**Files:** none

- [ ] **Step 1: Build everything**

```bash
yarn build
```

Expected: all packages build without errors.

- [ ] **Step 2: Lint**

```bash
yarn lint
```

Expected: no lint errors.

- [ ] **Step 3: Unit tests**

```bash
yarn test
```

Expected: all tests pass.

- [ ] **Step 4: Integration tests**

```bash
yarn test:integration
```

Expected: all tests pass; no flaky failures.

- [ ] **Step 5: Manual smoke test**

```bash
yarn dev
```

Navigate to `/backend/integrations`. Confirm three observability tiles: PostHog, Langfuse, Sentry. Click each → detail page → credentials form renders. Save credentials → health check → enabled state persists.

- [ ] **Step 6: If anything fails — fix inline, re-run, commit. Do not proceed to Task 29 until all four above pass.**

---

### Task 29: Open PR against `twn/develop`

**Files:** none

- [ ] **Step 1: Check branch state**

```bash
git log --oneline twn/develop..HEAD
```

Expected: list of the spec + feature commits.

- [ ] **Step 2: Push latest**

```bash
git push twn feat/observability-posthog-langfuse-sentry
```

- [ ] **Step 3: Create draft PR via gh CLI or the URL printed by `git push`**

Title: `feat(observability): PostHog + Langfuse + Sentry integration`

Body (paste into PR description):

```markdown
## Summary
- Adds `@open-mercato/observability` package registering PostHog, Langfuse, and Sentry as Integration Marketplace providers.
- Cloud and self-hosted parity via credential-level `host`/`dsn` fields.
- Server event forwarding, admin + portal browser instrumentation, AI assistant LLM tracing.
- Additive — no DB schema changes, no breaking contract impact.

Spec: `.ai/specs/2026-04-18-observability-integration-posthog-langfuse-sentry.md`
Plan: `.ai/plans/2026-04-18-observability-integration-posthog-langfuse-sentry.md`

## Test plan
- [x] Unit tests (`yarn test`)
- [x] Integration tests (`yarn test:integration`)
- [x] Manual: marketplace listing shows three tiles, credentials save/load, health checks return status
- [x] Manual: AI assistant still works without observability package installed (noop tracer)
```

Target: `TWN-Systems/open-mercato:develop` (fork-level PR first). After green CI, open upstream PR against `open-mercato/open-mercato:develop`.

---

## Self-Review

**1. Spec coverage**
- Package scaffold → Task 1
- Module metadata, ACL, Integration definitions → Task 2
- App registration → Task 3
- Redaction → Task 4
- Tenant config resolver → Task 5
- Event mapper → Task 6
- PostHog client + health → Task 7
- PostHog subscriber → Task 8
- Sentry server init + withTenantScope → Task 9
- Sentry instrumentation wiring → Task 10
- Sentry interceptor → Task 11
- Sentry health → Task 12
- llmTracer DI token no-op → Task 13
- Wrap LLM call sites → Task 14
- Langfuse client + tracer + health → Task 15
- Observability DI registration + llmTracer override → Task 16
- Client-config API → Task 17
- Admin shell widget → Task 18
- Portal shell widget → Task 19
- Env preset → Task 20
- setup.ts → Task 21
- CLI → Task 22
- i18n → Task 23
- README + RELEASE_NOTES → Task 24
- Integration tests (lifecycle) → Task 25
- Integration tests (event forwarding) → Task 26
- AI-assistant decoupling test → Task 27
- Full validation → Task 28
- PR → Task 29

All spec sections covered.

**2. Placeholders** — none. Each step has concrete code or exact command.

**3. Type consistency**
- `LLMTracer.traceLLM` signature identical in Tasks 13 & 15 (`(opts, fn) => Promise<T>`, ctx with `recordGeneration`).
- `TenantObservabilityConfig` fields (`posthog`, `langfuse`, `sentry`) used consistently in Tasks 5, 8, 16, 17.
- `PosthogCredentials`, `LangfuseCredentials`, `SentryCredentials` types defined once (Task 2) and reused unchanged.
- `observabilityTenantConfig` DI name used consistently in Tasks 8, 16, 17, 22.
- Integration IDs (`observability_posthog`, `observability_langfuse`, `observability_sentry`) consistent across Tasks 2, 5, 20, 25.

Plan complete.
