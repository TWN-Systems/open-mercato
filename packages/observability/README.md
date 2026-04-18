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
yarn mercato observability configure-from-env --tenant <tenantId> --org <organizationId>
```

Emit a synthetic PostHog event to verify forwarding:

```bash
yarn mercato observability test-capture --tenant <tenantId>
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
