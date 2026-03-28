# SPEC-062 — Zammad + Stalwart Integration Providers

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-28 |
| **Related** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub), SPEC-045d (Communication Hub), SPEC-043 (Reactive Notification Handlers) |

---

## TLDR

Two independent provider packages — `packages/provider-zammad` and `packages/provider-stalwart` — wired together through OM's workflow engine. Zammad provides helpdesk ticket management with CRM contact sync and a timeline widget on the customer detail page. Stalwart provides inbound webhook delivery events (bounces, delivery confirmations, quota warnings). A workflow template in `provider-zammad` connects them: bounce detected by Stalwart → note on active Zammad ticket → flag contact email as invalid → notify account owner. All credentials are configured per-tenant via the OM integration admin UI — no shared env defaults.

---

## Problem Statement

Teams running self-hosted Zammad (helpdesk) and Stalwart (mail server) have no way to surface support ticket context inside the OM CRM, sync CRM contacts to Zammad, or react to mail delivery failures (bounces) automatically. The result is:

- Support agents context-switch between OM and Zammad to see customer history
- Bounced emails are invisible in the CRM until a human checks mail logs
- Collections and billing follow-up flows lack automated delivery-failure awareness
- Multi-tenant operators with separate Zammad and Stalwart servers per tenant have no mechanism for per-tenant configuration

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  OM Integration Marketplace (/backend/integrations)     │
│                                                         │
│  [provider-stalwart]        [provider-zammad]           │
│   credentials per tenant     credentials per tenant     │
│   • stalwartBaseUrl          • zammadBaseUrl            │
│   • stalwartApiKey           • zammadApiToken           │
│   • webhookSigningSecret     • webhookSigningSecret     │
│   • queueMappings            • groupMappings            │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             ▼                            ▼
      Stalwart Admin API          Zammad REST API v1
      (delivery events,           (customers, tickets,
       webhook push)               groups, notes)
             │                            │
             └──────────┬─────────────────┘
                        ▼
              OM Workflow Engine
              (bounce → ticket note,
               contact sync, queue routing,
               OM notifications)
```

The two packages share no code and hold no direct dependency on each other. Integration between them is purely event-driven: `stalwart.message.bounced` events are consumed by a workflow template shipped with `provider-zammad`.

---

## Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Two packages, zero coupling** | Each is independently installable; tenants using only one service install only that package |
| 2 | **Per-tenant credentials only** | No env var defaults; every credential configured via OM credentials UI — supports multi-tenant operators with separate servers per tenant |
| 3 | **Field-level ownership for contact sync** | OM owns CRM fields; Zammad owns support-context fields; conflicts logged, never silently overwritten |
| 4 | **Queue/group mappings are tenant-configurable** | Static mailbox topology (security@, support@, billing@, collections-team@, info@/hello@, accounts@) reflected in credentials JSON with alias and fallback support |
| 5 | **Workflow engine for cross-package logic** | Bounce → ticket note flow is a named workflow template, inspectable and customizable by the tenant |
| 6 | **Fail-closed webhooks** | Unverified webhook payloads are rejected with 401 and logged; never processed |
| 7 | **Provider-standard patterns** | Follows SPEC-045a credentials API, operation logs, health check contract, and SPEC-045b DataSyncAdapter where applicable |

---

## Package: `packages/provider-stalwart`

### Credentials Shape

```typescript
interface StalwartCredentials {
  stalwartBaseUrl: string           // e.g. https://mail.example.com
  stalwartApiKey: string            // Stalwart admin API bearer token
  webhookSigningSecret: string      // HMAC-SHA256 secret for webhook verification

  queueMappings: {
    [mailbox: string]: {
      teamId: string                // OM team to notify
      notifyRoleId: string          // OM role to route notifications to
      aliasOf?: string              // inherit config from another mailbox (e.g. "accounts@" aliasOf "billing@")
      fallbackMailbox?: string      // contact fallback if no specific contact set (e.g. "collections-team@" → "billing@")
    }
  }
}
```

**Default queue topology (tenant configures values, keys are illustrative):**

| Mailbox | Notes |
|---|---|
| `security@` | Own team + notifyRoleId |
| `support@` | Own team + notifyRoleId |
| `billing@` | Own team + notifyRoleId |
| `accounts@` | `aliasOf: "billing@"` — inherits billing config |
| `collections-team@` | Own team + notifyRoleId; `fallbackMailbox: "billing@"` for contact resolution |
| `info@` | Own team + notifyRoleId |
| `hello@` | `aliasOf: "info@"` |

### Events (`events.ts`)

```typescript
// stalwart.message.bounced
{
  messageId: string
  recipient: string          // full email address
  mailbox: string            // originating OM queue (e.g. "billing@")
  reason: string             // SMTP status e.g. "5.1.1 User unknown"
  isPermanent: boolean       // true if reason matches /^5\./
  timestamp: string          // ISO 8601
  notifyRoleId: string       // resolved from queueMappings in webhook handler — Zammad workflow reads this directly
  teamId: string             // resolved from queueMappings in webhook handler
}

// stalwart.message.delivered
{ messageId: string, recipient: string, mailbox: string, timestamp: string }

// stalwart.quota.warning
{ mailbox: string, usedBytes: number, limitBytes: number, tenantId: string }
```

### Webhook Endpoint (`api/post/integrations/stalwart/webhook.ts`)

```
POST /api/integrations/stalwart/webhook
Headers: X-Stalwart-Signature: sha256=<hmac-sha256>
```

1. Resolve tenant from request context
2. Load `stalwartCredentials` for tenant
3. Verify HMAC-SHA256 of raw body against `webhookSigningSecret` — reject `401` on failure, log `security` severity to `IntegrationLog`
4. Map Stalwart event type → OM event, emit via event bus
5. Log to `IntegrationLog` with `messageId` and `recipient` as context

### Outbound API Calls

| Operation | Stalwart endpoint | Triggered by |
|---|---|---|
| Enrich bounce with delivery log | `GET /api/store/mail/{messageId}` | bounce webhook handler |
| List mailbox aliases | `GET /api/principal/{mailbox}` | health check |

### Health Check

`GET /api/principal/postmaster` — verifies API key and reachability. Displayed on integration card as "Connected" / "Unreachable".

---

## Package: `packages/provider-zammad`

### Credentials Shape

```typescript
interface ZammadCredentials {
  zammadBaseUrl: string             // e.g. https://support.example.com
  zammadApiToken: string            // Zammad HTTP Token auth
  webhookSigningSecret: string      // X-Hub-Signature verification

  groupMappings: {
    [zammadGroupId: number]: {
      teamId: string
      notifyRoleId: string
      queueLabel: string            // display label e.g. "Billing", "Collections", "Security"
      color?: string                // optional UI accent color for timeline widget
    }
  }

  fieldOwnership: {
    omOwned: string[]               // fields OM pushes to Zammad e.g. ["note", "account_owner_id"]
    zammadOwned: string[]           // fields Zammad pushes to OM e.g. ["support_tier", "sla_group"]
  }
}
```

### Database Entity: `zammad_contact_link`

```
zammad_contact_link
  id                  uuid PK
  tenant_id           uuid
  om_contact_id       uuid          FK by ID only — no ORM relation
  zammad_customer_id  integer
  last_synced_at      timestamptz
  sync_direction      enum('om_to_zammad', 'zammad_to_om', 'bidirectional')
  created_at          timestamptz
  updated_at          timestamptz

  UNIQUE (tenant_id, om_contact_id)
  UNIQUE (tenant_id, zammad_customer_id)
```

### Events (`events.ts`)

```typescript
// zammad.ticket.created
{
  ticketId: number
  customerId: number             // Zammad customer ID
  omContactId: string | null     // resolved from zammad_contact_link
  groupId: number
  queueLabel: string             // resolved from groupMappings
  notifyRoleId: string
  subject: string
  tenantId: string
}

// zammad.ticket.closed
{ ticketId: number, omContactId: string | null, groupId: number, resolvedAt: string }

// zammad.ticket.escalated
{ ticketId: number, omContactId: string | null, groupId: number, slaBreachedAt: string }

// zammad.contact.updated
{ zammadCustomerId: number, omContactId: string, changedFields: string[] }

// contact.email.invalidated  (emitted by bounce workflow)
{ omContactId: string, email: string, reason: string, messageId: string }
```

### Webhook Endpoint (`api/post/integrations/zammad/webhook.ts`)

```
POST /api/integrations/zammad/webhook
Headers: X-Hub-Signature: sha256=<hmac-sha256>
```

1. Verify HMAC — reject `401` on failure
2. Resolve `group_id` → `queueLabel` + `notifyRoleId` from credentials `groupMappings`
3. Resolve `customer_id` → `omContactId` via `zammad_contact_link`
4. Emit typed OM event
5. Log to `IntegrationLog`

### Outbound API Calls

| Operation | Zammad endpoint | Triggered by |
|---|---|---|
| Create customer | `POST /api/v1/customers` | OM contact created |
| Update customer (omOwned fields only) | `PUT /api/v1/customers/{id}` | OM contact updated |
| Get open tickets for contact | `GET /api/v1/tickets?customer_id={id}&state=open` | timeline widget load |
| Get ticket by message ID | `GET /api/v1/tickets?search=messageId:{id}` | bounce workflow step 3 |
| Create ticket | `POST /api/v1/tickets` | bounce workflow (no existing ticket) |
| Create ticket article (note) | `POST /api/v1/ticket_articles` | bounce workflow step 4 |

### Health Check

`GET /api/v1/users/me` — verifies token. Result displayed on integration card as "Connected as: {login}" using the agent identity returned by Zammad.

### CRM Timeline Widget

Injected into the customer detail page via `widgets/injection/` targeting the `customer:detail:timeline` spot. If this spot does not exist, it must be declared in the customers module as part of this implementation.

```
┌─ Zammad Tickets ──────────────────────────────────┐
│ [Collections] Invoice dispute #4521    OPEN   →   │
│ [Billing]     Payment query #4490      CLOSED     │
│ [Support]     Login issue #4410        CLOSED     │
│ [Security]    Phishing report #4389    OPEN   →   │
│                                                   │
│                              [+ New Ticket]       │
└───────────────────────────────────────────────────┘
```

- Queue label and colour from `groupMappings[groupId].queueLabel` / `.color`
- Open tickets link to Zammad (external link, new tab)
- "New Ticket" opens a dialog: subject input + group selector → `POST /api/v1/tickets`
- Widget renders "Link to Zammad" prompt if no `zammad_contact_link` exists for the contact
- Data loaded via `apiCall` from a backend route in the provider package

---

## Workflow Template: Bounce → Zammad Ticket Note

Shipped as a named workflow template in `provider-zammad`. Activates only when both `provider-stalwart` and `provider-zammad` are enabled for the tenant. Tenant can inspect, modify, or disable via the OM workflow editor.

```
Trigger: stalwart.message.bounced

Step 1: Resolve OM contact by recipient email
  → not found: log IntegrationLog warn, stop

Step 2: Resolve zammad_contact_link for om_contact_id
  → no link: log IntegrationLog warn, stop

Step 3: GET open tickets for zammad_customer_id
  → none found: POST new ticket "Delivery failure: {recipient}"
  → found: use most recently updated open ticket

Step 4: POST ticket article (internal note)
  body: "Outbound email to {recipient} bounced: {reason}
         Message ID: {messageId} — {timestamp}"

Step 5 (permanent failures only — isPermanent === true):
  → PATCH OM contact: email_invalid = true
  → emit contact.email.invalidated
  → if sequences module enabled: pause active outbound sequences for contact

Step 6: Emit OM in-app notification
  → use event.notifyRoleId (pre-resolved by Stalwart webhook handler, fallback already applied)
  → notification: "Delivery failure for {contactName} ({recipient})"
     links to contact detail page
```

All steps are idempotent. Failed workflow instances are retried by the queue worker (max 3×, exponential backoff). Dead-letter entries visible in the integration operation log.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Webhook HMAC mismatch | `401`, log `security` severity to IntegrationLog, no event emitted |
| Zammad `401` | Disable integration for tenant, emit admin notification "Zammad token invalid — reconnect required" |
| Zammad `404` on ticket lookup | Log `warn`, workflow continues (creates new ticket at step 3) |
| Zammad `5xx` | Retry 3× exponential backoff via queue worker; after 3 failures log `error` |
| Stalwart `401` | Disable integration for tenant, emit admin notification |
| Stalwart delivery log not found | Bounce event still emitted, enrichment fields left null |
| Contact sync conflict (same field changed both sides within 60s) | Log `conflict` severity to IntegrationLog, neither side overwritten, admin resolves manually |
| Collections contact not set | Fall back to `billing@` contact via `queueMappings[mailbox].fallbackMailbox` |

---

## Access Control

Both provider packages declare features in `acl.ts`:

```
stalwart.view       — view integration status and operation logs
stalwart.manage     — configure credentials and queue mappings

zammad.view         — view tickets in timeline widget
zammad.manage       — configure credentials, group mappings, field ownership
zammad.ticket.create — create tickets from CRM
```

`defaultRoleFeatures` grants `*.view` to all authenticated users, `*.manage` to admin role only.

---

## Risks & Impact

| Risk | Severity | Mitigation |
|---|---|---|
| Webhook replay attacks | High | HMAC verification + `messageId` deduplication in IntegrationLog |
| Stalwart API key leaked via OM logs | High | Credentials never logged; IntegrationLog stores only `messageId`/`recipient` |
| Contact sync overwriting Zammad-owned fields | Medium | `fieldOwnership` enforced before every outbound PUT — only `omOwned` fields sent |
| Collections fallback routing silently using billing contact | Low | Fallback logged to IntegrationLog at `info` severity on each use |
| Multi-tenant credential isolation | High | OM credentials API is scoped per `tenant_id`; webhook handler resolves tenant before credential lookup |
| Zammad token rotation causes silent failures | Medium | Health check runs on schedule; `401` response disables integration and notifies admin immediately |

---

## Integration Coverage

### API paths requiring integration tests

- `POST /api/integrations/stalwart/webhook` — valid signature, invalid signature, bounce event, delivery event, quota warning
- `POST /api/integrations/zammad/webhook` — valid/invalid signature, ticket.create with group resolution, contact.update with field ownership
- Contact sync: OM contact created → Zammad customer created
- Contact sync: Zammad webhook → only zammadOwned fields updated in OM
- Timeline widget backend route: returns tickets grouped by queue label
- Bounce workflow: permanent bounce → contact flagged invalid + ticket note created

### UI paths requiring integration tests

- `/backend/integrations` — Stalwart and Zammad cards appear when packages installed
- Stalwart credential form: all required fields, queueMappings JSON editor
- Zammad credential form: all required fields, groupMappings + fieldOwnership editors
- Customer detail page: timeline widget renders tickets, "New Ticket" dialog submits successfully
- Customer detail page: "Link to Zammad" prompt shown when no link exists

---

## Changelog

| Date | Change |
|---|---|
| 2026-03-28 | Initial draft |
