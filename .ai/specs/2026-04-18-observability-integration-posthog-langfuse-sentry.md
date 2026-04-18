# 2026-04-18 — Observability Integration (PostHog + Langfuse + Sentry)

## TLDR

Add a single workspace package `@open-mercato/observability` containing one module that registers three independent integration providers — PostHog (product analytics), Langfuse (LLM/AI observability), and Sentry (error and performance monitoring) — against the existing Integration Marketplace. Covers server-side event forwarding, admin and customer portal browser instrumentation, and AI assistant LLM tracing. Self-hosted and cloud deployments are interchangeable via credential fields (`host` / `dsn`). Ship with env-preset bootstrap, per-tenant enable/disable, shared PII redaction, and no-op fallbacks so every consumer works whether the integration is enabled or absent.

## Overview

Open Mercato currently has no first-class observability story. Tenants instrument their own analytics and error tracking ad-hoc, bypassing the Integration Marketplace. This spec introduces a cohesive bundle — three battle-tested OSS-friendly tools, each working against its own cloud or self-hosted deployment — delivered as marketplace integrations so tenants enable and configure them from the admin UI with zero code.

### Goals

- Install-and-configure observability across admin backend, customer portal, and AI assistant via the marketplace flow.
- Equal support for cloud and self-hosted PostHog, Langfuse, and Sentry deployments.
- Zero runtime cost and zero bundle cost when a provider is disabled.
- Respect existing open-mercato contracts: integrations module services, event bus, DI, portal/backend shells, per-tenant isolation.
- Zero hard dependency on observability from core packages (ai-assistant remains functional without it).

### Non-Goals

- PostHog feature flags / experiments bridge to open-mercato feature toggles (v1).
- Langfuse prompts, datasets, evals surfaces in the admin UI.
- Sentry release tracking and source-map uploads (documented follow-up — requires CI pipeline changes).
- Per-organization (sub-tenant) observability config — v1 is per-tenant.
- Custom event schema editor UI — v1 uses tenant-config JSON allowlist/denylist.

## Problem Statement

1. No standard way to forward open-mercato events to an analytics backend.
2. AI assistant LLM calls are unobservable — no traces, no token/cost accounting, no prompt debugging.
3. No unified error tracking across server + admin + portal.
4. Existing Integration Marketplace pattern covers payments, shipping, ERP sync — observability does not yet have a reference provider. Tenants bolt their own tooling on, producing divergent setups.
5. Any solution must accommodate both SaaS (multi-tenant cloud) and single-tenant self-hosted deployments without diverging code paths.

## Proposed Solution

One workspace package `packages/observability/` exposing the module `observability`. The module registers three `IntegrationDefinition`s with the marketplace:

- `posthog` — product analytics (server capture + browser).
- `langfuse` — AI/LLM observability (server-only; wraps ai-assistant LLM calls).
- `sentry` — error and performance monitoring (server + browser).

Per-tenant enablement, credentials, and health use the existing `integrations` services. A shared tenant-config resolver, a shared redaction helper, and a single browser-safe client-config API serve all three providers.

Self-host vs cloud is a credential-level concern: PostHog and Langfuse accept a `host` field; Sentry's DSN encodes host. Env-preset bootstrap is implemented in the provider package per the integrations module contract.

### Rationale

- **Single package, three integrations**: shared redaction/config/event-mapper avoids duplication, preserves independent enable/disable, and lets users adopt only what they need. This matches the bundle-or-independent tradeoff guidance in `packages/core/src/modules/integrations/AGENTS.md`.
- **Server subscriber for PostHog**: open-mercato already has a typed event bus; a wildcard subscriber is the smallest-impact forwarding mechanism and keeps the allowlist logic centralized.
- **DI-injected tracer for Langfuse**: ai-assistant must not hard-depend on observability. An additive `llmTracer` DI token with a no-op default implementation, overridden by observability's `di.ts` when installed, keeps both modules decoupled and builds without the other.
- **Shell-wrapper widgets for browser init**: the existing component replacement and widget-injection system is the ordained extension surface for admin and portal shells. Dynamic imports of `posthog-js` / `@sentry/browser` keep bundle cost at zero when disabled.
- **Single `/api/observability/client-config`**: one browser-safe endpoint, tenant-scoped, returns merged config for all providers, avoids secret-key leakage and build-time baking.

## Architecture

### Package Layout

```
packages/observability/
├── package.json                          # @open-mercato/observability
├── build.mjs, watch.mjs, tsconfig.json   # mirror gateway-stripe
├── jest.config.cjs
└── src/
    ├── index.ts
    └── modules/
        └── observability/
            ├── index.ts                  # module metadata
            ├── integration.ts            # 3 IntegrationDefinition exports + integrations[]
            ├── di.ts                     # DI registrations (see table below)
            ├── acl.ts                    # observability.view / manage / credentials.manage
            ├── setup.ts                  # default role features + preset bootstrap
            ├── events.ts                 # internal log events (no external-facing events)
            ├── cli.ts                    # configure-from-env, test-capture commands
            ├── data/
            │   └── validators.ts         # zod schemas per provider credentials
            ├── lib/
            │   ├── redaction.ts          # shared PII scrubber
            │   ├── tenant-config.ts      # cached per-tenant resolver
            │   ├── preset.ts             # env → credentials
            │   ├── posthog-client.ts
            │   ├── langfuse-client.ts
            │   ├── sentry-server.ts
            │   ├── sentry-instrumentation.ts
            │   ├── llm-tracer.ts
            │   ├── event-mapper.ts
            │   └── health/
            │       ├── posthog.ts
            │       ├── langfuse.ts
            │       └── sentry.ts
            ├── api/
            │   └── get/
            │       └── observability/
            │           └── client-config.ts
            ├── subscribers/
            │   └── forward-events.ts
            ├── widgets/
            │   ├── injection-table.ts
            │   └── injection/
            │       ├── admin-shell/widget.client.tsx
            │       ├── portal-shell/widget.client.tsx
            │       └── integration-detail/
            │           ├── posthog-panel.client.tsx
            │           ├── langfuse-panel.client.tsx
            │           └── sentry-panel.client.tsx
            ├── i18n/
            │   ├── en.ts
            │   └── pl.ts
            └── __tests__/
                ├── redaction.test.ts
                ├── tenant-config.test.ts
                ├── event-mapper.test.ts
                ├── preset.test.ts
                └── llm-tracer.test.ts
```

### Consumer-Side Touchpoints

- `apps/mercato/src/modules.ts` — register `@open-mercato/observability`.
- `apps/mercato/instrumentation.ts` — one import line delegating to observability's Sentry instrumentation (created if absent, kept minimal).
- `packages/ai-assistant/src/modules/ai_assistant/di.ts` — add DI token `llmTracer` with a no-op default; wrap existing LLM call sites with `tracer.traceLLM(...)`. Observability's `di.ts` overrides this token when Langfuse is enabled.

### DI Services (observability)

| Service name | Purpose |
|---|---|
| `observabilityTenantConfig` | Resolves `{ posthog, langfuse, sentry }` enable state + credentials per tenant, LRU-cached, invalidated on `integrations.credentials.updated` / `integrations.state.updated`. |
| `posthogClientFactory` | Lazy singleton `PostHog` node client per tenant (`posthog-node`). |
| `langfuseClientFactory` | Lazy singleton `Langfuse` client per tenant. |
| `sentryScopeHelper` | Wraps `Sentry.withScope` with tenant/org/user tagging. |
| `llmTracer` | Overrides ai-assistant's default no-op; Langfuse-backed `traceLLM`. |
| `posthogHealthCheck` / `langfuseHealthCheck` / `sentryHealthCheck` | Registered health check services referenced by each `IntegrationDefinition.healthCheck.service`. |

### Data Flow

#### PostHog server event forwarding

1. `subscribers/forward-events.ts` (wildcard subscriber) receives every event on the bus.
2. Looks up tenant config; short-circuits if PostHog disabled.
3. Applies allowlist/denylist from tenant config. Default allowlist: `auth.user.loggedIn`, `sales.order.created`, `sales.quote.accepted`, `catalog.product.created`, `customers.person.created`, `integrations.state.updated`, `workflows.instance.completed`. Default denylist matches `credentials`, `secret`, `password`, and `integrations.log.*`.
4. Maps payload via `event-mapper.ts`:
   - `distinctId` = actor user id, else `tenant:<tenantId>:system`.
   - `event` = open-mercato event id verbatim.
   - `properties` = redaction-scrubbed payload + `{ organization_id, tenant_id, open_mercato_version }`.
   - `groups` = `{ tenant: tenantId, organization: organizationId }`.
5. Fire-and-forget `capture(...)`; PostHog SDK batches/flushes. Errors logged via `integrationLogService`, never propagated.

#### Browser bootstrap (admin + portal)

1. Shell-wrapper widgets registered at admin-shell and portal-shell spots.
2. Widget fetches `GET /api/observability/client-config` (React Query, `staleTime: 5min`).
3. If `posthog.enabled`: dynamic-import `posthog-js`, `posthog.init(key, { api_host, autocapture, session_recording })`; `identify()` + `group()` the current user/customer and tenant.
4. If `sentry.enabled`: dynamic-import `@sentry/browser`, `Sentry.init({ dsn, environment, tracesSampleRate })`; set tenant/org tags and user context.
5. Subscribes to `useAppEvent` / `usePortalAppEvent` to forward notable browser events.

#### Langfuse AI tracing

- `llm-tracer.ts` exports `traceLLM<T>(opts, fn): Promise<T>`. Creates a Langfuse `trace`, wraps each LLM call in a `generation` span capturing scrubbed input/output, tokens, latency, model, and tenant/user metadata.
- Default no-op implementation registered in ai-assistant DI; observability overrides it when Langfuse is enabled.
- Resolved per-request via existing DI container → tenant isolation is automatic.

#### Sentry multi-tenant flow

- Process-global init reads `SENTRY_DSN` env or first enabled tenant's DSN (single-tenant self-host case).
- Per-request API interceptor on `*` routes sets `tenant_id`, `organization_id`, `user` via `Sentry.withScope`.
- Browser Sentry uses the tenant-specific DSN returned by client-config → fully per-tenant client errors.
- README documents the multi-tenant SaaS caveat: for strict per-tenant project isolation, operate separate Sentry projects with a reverse proxy, or use `tenant_id` as the primary filter.

### Redaction (`lib/redaction.ts`)

Applied at all three sinks. Deep-walks objects; redacts values for keys matching `/^(password|secret|token|apiKey|privateKey|authorization|cookie|sessionId|creditCard|cvv|ssn|dsn)/i` → `'[REDACTED]'`. Truncates any string > 8KB to `'[TRUNCATED:<length>]'`. Opt-in extra keys via tenant config `redactionKeys: string[]`.

### Failure Policy

- All three providers: **fail open**. Never break the host request or event.
- Errors logged via `integrationLogService` with provider id and event context.
- SDKs provide their own batching and rate limiting.

### Env Preset Variables

```
OM_INTEGRATION_POSTHOG_PROJECT_KEY
OM_INTEGRATION_POSTHOG_HOST                       (default: https://us.i.posthog.com)
OM_INTEGRATION_LANGFUSE_PUBLIC_KEY
OM_INTEGRATION_LANGFUSE_SECRET_KEY
OM_INTEGRATION_LANGFUSE_HOST                      (default: https://cloud.langfuse.com)
OM_INTEGRATION_SENTRY_DSN
OM_INTEGRATION_SENTRY_ENVIRONMENT                 (default: NODE_ENV)
OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE          (default: 0.1)
```

Preset applies via `setup.ts` on tenant bootstrap and via `cli.ts configure-from-env` for rerun.

## Data Models

No new database entities. Reuses existing `integrations` module tables:

- `IntegrationCredentials` — stores encrypted credentials per `{ integrationId, tenantId }`. Secret fields (`secretKey`, `dsn`) encrypted; non-secret fields (`host`, `environment`, `tracesSampleRate`, `allowlist`, `denylist`, `redactionKeys`, `sessionRecording`) stored as plaintext `config` JSON.
- `IntegrationState` — enabled, apiVersion (unused for observability), health, reauth flag.
- `IntegrationLog` — reused for forwarder failures, health check results.

Credential schemas per provider (zod):

- **posthog**: `{ projectKey: secret, host: string, allowlist?: string[], denylist?: string[], sessionRecording?: boolean, redactionKeys?: string[] }`.
- **langfuse**: `{ publicKey: string, secretKey: secret, host: string, redactionKeys?: string[] }`.
- **sentry**: `{ dsn: secret, environment?: string, tracesSampleRate?: number, redactionKeys?: string[] }`.

## API Contracts

### New: `GET /api/observability/client-config`

Public, tenant-scoped (resolved from request context). Returns browser-safe config — **never** includes secret-grade fields (Langfuse `secretKey`, PostHog secret server-side key).

Response shape:

```ts
{
  posthog: { enabled: boolean, key?: string, host?: string, sessionRecording?: boolean } | null,
  sentry:  { enabled: boolean, dsn?: string, environment?: string, tracesSampleRate?: number } | null,
  langfuse: { enabled: boolean } | null
}
```

Exports `openApi` per core API rules. Additive route; no existing route modified.

### Consumed routes

- Marketplace routes under `/api/integrations/*` — used as-is for enable, disable, credentials CRUD, health check trigger.

## Module Interface

- `packages/ai-assistant/src/modules/ai_assistant/di.ts` — register a no-op `llmTracer` as default DI token. Additive.
- `packages/ai-assistant/src/modules/ai_assistant/**/llm-*.ts` — wrap existing LLM call sites with `tracer.traceLLM(...)`. Additive (wrappers are transparent when tracer is no-op).
- `packages/observability/src/modules/observability/di.ts` — overrides `llmTracer` with the Langfuse-backed implementation when Langfuse is enabled for the tenant.

## Integration Coverage

### API paths

- `GET /api/observability/client-config` — unit + integration.
- `GET /api/integrations` — integration test: observability tiles appear.
- `GET /api/integrations/:id` (`posthog`, `langfuse`, `sentry`) — integration test: detail payload correct.
- `PUT /api/integrations/:id/credentials` — integration test per provider: encrypted storage, events fire.
- `PUT /api/integrations/:id/state` — integration test per provider.
- `POST /api/integrations/:id/health` — integration test per provider, with mocked SDK endpoints.

### UI paths

- `/backend/integrations` — marketplace listing shows all three tiles.
- `/backend/integrations/posthog`, `/langfuse`, `/sentry` — detail pages with credentials form and health check.
- Admin shell — PostHog and Sentry browser initialization (verified by network request to provider endpoints when enabled).
- Portal shell — same as admin.
- AI assistant chat — with Langfuse enabled, traces appear in Langfuse mock sink.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| PII leakage through forwarded events | High | PostHog, Sentry, Langfuse | Shared redaction; per-tenant extra keys; default denylist covers credential-bearing events; scrubbed at all three sinks. | Low — tenant-specific payloads may still carry sensitive fields with unusual keys; documented as tenant responsibility. |
| Bundle-size regression when disabled | Medium | Admin + portal bundles | Dynamic `import()` of `posthog-js` and `@sentry/browser`; widget wrappers only fetch client-config and return children otherwise. | Near-zero — verified by bundle analyzer in tests. |
| AI assistant breakage on missing observability | High | `packages/ai-assistant` build | No-op default `llmTracer` in ai-assistant DI; observability only overrides when installed. Build and runtime verified without observability package. | Low — additive DI contract, covered by unit test. |
| Sentry process-global init leaks tenant data across tenants | High | Multi-tenant SaaS | `withScope` per request; README documents multi-project recommendation for strict isolation. | Medium — architectural limit of Sentry Node SDK; explicit doc. |
| Event forwarder introduces latency | Medium | Server event bus | Fire-and-forget; SDKs batch; timeouts bounded by SDK defaults; health check surfaces degraded state. | Low. |
| Self-hosted endpoint unreachable at init | Medium | PostHog / Langfuse / Sentry | Health check + `IntegrationState.health='unhealthy'`; fail-open keeps hosts running. | Low. |
| Credential encryption regressions | High | All three | Use `findWithDecryption`/`findOneWithDecryption`; zod validators reject malformed; log service strips secrets. | Low. |
| Wildcard subscriber fires for every event | Medium | CPU/memory under load | Early-exit on disabled PostHog before any mapping; cached tenant config; O(1) allowlist lookup. | Low. |
| Sentry API interceptor order | Low | Tag coverage | Register interceptor with low priority so it wraps handler; fallback: global Sentry init still captures untagged errors. | Low. |
| Browser SDK version drift (posthog-js major bump) | Low | Admin/portal shell | Pin minor versions in observability `package.json`; integration tests assert init signature. | Low. |

## Alternatives Considered

- **Separate packages per provider**: rejected — triples scaffolding for small code volume; no code shared between providers would be deduplicated. Approach A (one package, three integrations) retains independent enable/disable while sharing redaction, tenant-config, and client-config.
- **Typed event subscribers per event**: rejected — exhaustive per-event subscribers balloon over time and miss new events. Wildcard subscriber with allowlist is maintenance-free for new events.
- **Hard dependency from ai-assistant on observability**: rejected — breaks the "works without optional integrations" contract. Additive DI token preserves decoupling.
- **Per-organization config**: deferred to v2 — adds UX complexity without clear demand.

## Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`, this spec is **fully additive**:

- **Surfaces 1, 5, 6, 10, 11, 13**: unchanged (no auto-discovery conventions, event IDs, widget spot IDs, ACL feature IDs, notification type IDs, or generator file contracts renamed or removed).
- **Surface 2 (types)**: new `LLMTracer` interface in ai-assistant with default no-op — additive, not required.
- **Surface 4 (imports)**: new package only; no moved files.
- **Surface 7 (API routes)**: one new route; no existing route modified.
- **Surface 8 (database schema)**: no changes.
- **Surface 9 (DI service names)**: new names only (`observabilityTenantConfig`, `posthogClientFactory`, `langfuseClientFactory`, `sentryScopeHelper`, `llmTracer`, three health check services); ai-assistant gains `llmTracer` registration.
- **Surface 12 (CLI commands)**: new provider-scoped commands (`observability configure-from-env`, `observability test-capture`); no existing commands affected.

No deprecation protocol required.

## Testing Strategy

### Unit (Jest, co-located `__tests__/`)

- `redaction.test.ts` — key patterns, nested objects, array values, truncation boundaries, opt-in extra keys.
- `event-mapper.test.ts` — distinctId resolution, allowlist/denylist, group assignment, tenant/org scoping, fallback paths.
- `tenant-config.test.ts` — cache hit/miss, invalidation on credentials/state events, disabled → `null`.
- `preset.test.ts` — env var parsing, missing vars no-op, partial credentials rejected, idempotent re-apply.
- `llm-tracer.test.ts` — no-op path when disabled, span lifecycle, error propagation, input/output scrubbing.
- `health/posthog.test.ts`, `health/langfuse.test.ts`, `health/sentry.test.ts` — success and failure paths against mocked SDKs.

### Integration (Playwright, `__integration__/` per `.ai/qa/AGENTS.md`)

Each test creates fixtures via API and cleans up in `finally`.

- Enable/disable each provider via the marketplace API; assert state updates and events fire.
- PUT credentials per provider; assert encrypted storage and health check state transitions.
- `GET /api/observability/client-config` returns correct tenant-scoped payload; secret keys omitted.
- Canned open-mercato event (`sales.order.created`) → mocked PostHog endpoint; assert capture payload shape, scrubbing, group tags, allowlist behavior.
- Env-preset flow: set `OM_INTEGRATION_POSTHOG_*` before tenant setup; assert credentials present and integration enabled post-setup.
- Negative: missing credentials → health fails → state `unhealthy`, host app stays up.
- Self-host path: `host` set to a local mock; assert SDK calls go there for PostHog and Langfuse; Sentry DSN points at mock and receives events.
- ai-assistant build + runtime without `@open-mercato/observability` → no-op tracer path exercised.

## Acceptance Criteria

- `yarn build`, `yarn lint`, `yarn test`, `yarn test:integration` pass.
- Admin + portal bundle size delta = 0 when all providers disabled (bundle-analyzer snapshot in CI or manual verification).
- ai-assistant package builds and runs without `@open-mercato/observability`.
- Enabling each provider via the marketplace UI (no code changes) results in working traces/events within 60 seconds.
- Health check for each provider returns `healthy` within 10 seconds of valid credentials being saved.

## Documentation

- `packages/observability/README.md` — env presets, self-host configuration per provider, default PostHog allowlist and customization, multi-tenant Sentry caveat, security model (redaction, secret handling).
- `RELEASE_NOTES.md` — entry flagging new optional dependencies (`posthog-node`, `posthog-js`, `langfuse`, `@sentry/nextjs`, `@sentry/browser`).
- `apps/docs/` — optional: integration guide page (deferred to follow-up unless trivial).

## Out of Scope (explicit)

- PostHog feature-flag bridge to open-mercato feature toggles.
- Langfuse prompt management, datasets, evals UI.
- Sentry release tracking / source-map upload.
- Per-organization (sub-tenant) observability config.
- Custom event-schema editor UI for the PostHog allowlist (v1 uses tenant-config JSON).

## Final Compliance Report

- **AGENTS.md: "Simplicity First"** — one package, minimal consumer-side touchpoints (`modules.ts`, `instrumentation.ts`, ai-assistant DI token), no database changes.
- **AGENTS.md: "No direct ORM relationships between modules"** — observability consumes integrations services via DI; no cross-module ORM relations.
- **AGENTS.md: "Always filter by organization_id/tenant_id"** — all reads/writes go through `integrationCredentialsService` / `integrationStateService`, which enforce scoping.
- **AGENTS.md: "Encrypted credential reads"** — uses `findWithDecryption` / `findOneWithDecryption` inside the integrations services.
- **AGENTS.md: "Provider-owned env preconfiguration"** — preset logic lives in `packages/observability/lib/preset.ts` and `setup.ts`; `cli.ts configure-from-env` command rerunnable.
- **AGENTS.md: "Never import from provider modules into integrations"** — observability imports from integrations; integrations does not import from observability.
- **AGENTS.md: "Never log credential values"** — redaction applied at all three sinks; `integrationLogService` used for forwarder failures.
- **AGENTS.md: "Integration tests self-contained"** — all integration tests create fixtures via API and clean up in `finally`.
- **AGENTS.md: "API routes MUST export openApi"** — `client-config` exports `openApi`.
- **AGENTS.md: "Feature naming"** — `observability.view`, `observability.manage`, `observability.credentials.manage`.
- **BACKWARD_COMPATIBILITY.md** — fully additive; deprecation protocol not required.

## Changelog

- **2026-04-18** — Initial spec drafted.
