# SPEC-064 — Cal.com Integration

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-28 |
| **Related** | SPEC-045 (Integration Marketplace), SPEC-045a (Integration Foundation), SPEC-045b (Data Sync Hub), SPEC-043 (Reactive Notification Handlers) |

## Overview

A full cal.com integration for Open Mercato covering four capabilities built on a shared webhook-first foundation:

1. **Webhook receiver** — inbound cal.com webhooks emit typed OM events for workflow triggers
2. **CRM Activity sync** — bookings automatically become Activities linked to People/Deals
3. **Contact sync** — OM People pushed to cal.com attendee profiles via the data_sync hub
4. **Customer portal** — authenticated portal customers can book meetings via an embedded page

Supports both cal.com cloud (`https://api.cal.com`) and self-hosted instances via a configurable base URL.

---

## Architecture

Single workspace package, one module, webhook-first approach. All capabilities are layered on a common API client and event system — each can be toggled independently.

```
packages/cal-com/
└── src/modules/cal_com/
    ├── index.ts
    ├── integration.ts
    ├── di.ts
    ├── acl.ts
    ├── setup.ts
    ├── events.ts
    ├── lib/
    │   ├── client.ts
    │   ├── health.ts
    │   └── preset.ts
    ├── api/
    │   └── post/webhooks/cal-com.ts
    ├── subscribers/
    │   ├── booking-to-activity.ts
    │   ├── booking-rescheduled.ts
    │   ├── booking-cancelled.ts
    │   ├── no-show.ts
    │   ├── meeting-ended.ts
    │   └── person-sync-push.ts
    ├── workers/
    │   └── contact-sync.ts
    ├── data/
    │   ├── entities.ts
    │   ├── validators.ts
    │   └── extensions.ts
    ├── widgets/
    │   ├── injection-table.ts
    │   └── injection/
    │       ├── schedule-button/widget.client.tsx
    │       └── portal-booking/widget.client.tsx
    └── i18n/
        └── en.ts
```

---

## Section 1: Foundation

### Integration Definition (`integration.ts`)

- `id`: `cal_com`
- `category`: `scheduling`
- `hub`: omitted — cal.com is a standalone integration, not a hub+spoke. If future scheduling providers (Calendly, HubSpot Meetings) are added, a `scheduling` hub module should be defined in core first with an `ISchedulingProvider` adapter contract. For now cal.com registers directly in the marketplace without a hub.
- `healthCheck.service`: `calComHealthCheck` (calls `GET /api/v2/me` and `GET /api/v2/attendees` to verify attendee scope)

### Credentials Fields

| Key | Type | Required | Notes |
|---|---|---|---|
| `apiKey` | `secret` | Yes | cal.com API key from Settings → Developer → API Keys |
| `baseUrl` | `url` | No | Defaults to `https://api.cal.com`. Set for self-hosted instances. |
| `webhookSecret` | `secret` | Yes | HMAC-SHA256 signing secret from the cal.com webhook configuration |
| `defaultBookingLink` | `url` | No | Booking page URL pre-filled for the "Schedule Meeting" widget and portal page |

### API Client (`lib/client.ts`)

Thin wrapper over cal.com API v2 (`/api/v2/`). Reads `baseUrl` and `apiKey` from resolved credentials. Used by the health check, contact sync worker, and any future outbound calls.

### Env Preconfiguration (`lib/preset.ts`, applied from `setup.ts`)

| Env Var | Maps to |
|---|---|
| `OM_INTEGRATION_CALCOM_API_KEY` | `apiKey` credential |
| `OM_INTEGRATION_CALCOM_BASE_URL` | `baseUrl` credential |
| `OM_INTEGRATION_CALCOM_WEBHOOK_SECRET` | `webhookSecret` credential |
| `OM_INTEGRATION_CALCOM_DEFAULT_BOOKING_LINK` | `defaultBookingLink` credential |

### ACL Features

- `cal_com.view` — view integration status and logs
- `cal_com.manage` — enable/disable, run health checks, trigger sync

`setup.ts` `defaultRoleFeatures`:
- `cal_com.view` → granted to: `admin`, `employee`
- `cal_com.manage` → granted to: `admin`

---

## Section 2: Events & Webhook Handler

### Typed Events (`events.ts`)

`clientBroadcast` controls whether an event is broadcast to the browser via SSE (DOM Event Bridge) for real-time UI updates. It has no effect on workflow engine visibility — all events reach the workflow engine via the event bus regardless.

| Event ID | Label | cal.com Webhook Type | clientBroadcast |
|---|---|---|---|
| `cal_com.booking.created` | Booking Created | `BOOKING_CREATED` | true |
| `cal_com.booking.rescheduled` | Booking Rescheduled | `BOOKING_RESCHEDULED` | true |
| `cal_com.booking.cancelled` | Booking Cancelled | `BOOKING_CANCELLED` | true |
| `cal_com.booking.no_show` | Attendee No-Show | `BOOKING_NO_SHOW_UPDATED` | false |
| `cal_com.meeting.ended` | Meeting Ended | `MEETING_ENDED` | false |

**Normalized event payload**:
```typescript
{
  bookingId: string
  bookingUid: string
  eventTypeId: number
  eventTypeTitle: string
  startTime: string        // ISO 8601
  endTime: string          // ISO 8601
  attendeeEmail: string
  attendeeName: string
  organizerEmail: string
  bookingUrl: string
  metadata: Record<string, unknown>
}
```

### Webhook Receiver (`api/post/webhooks/cal-com.ts`)

- Route: `POST /api/webhooks/cal-com`
- Verifies `X-Cal-Signature-256` header against `webhookSecret` using HMAC-SHA256
- Returns `400` on invalid signature, `200` immediately on valid (async fan-out)
- Emits the matching typed OM event via the event bus
- Logs to integration log service: `info` on success, `error` on bad signature or unrecognised type
- No auth required (public endpoint) — signature verification is the auth

---

## Section 3: CRM Activity Sync

### Booking → Activity Subscriber (`subscribers/booking-to-activity.ts`)

- Event: `cal_com.booking.created` (persistent)
- Looks up `customers.person` by `attendeeEmail` within `organizationId`
- Creates an Activity:
  - Type: `meeting`
  - Title: `"{eventTypeTitle}" with {attendeeName}`
  - Date: `startTime`
  - Duration: derived from `startTime`/`endTime`
  - Notes: `bookingUrl`
  - Status: `scheduled`
  - Linked to matched Person (if found); unlinked otherwise
- Stores a `CalComBookingLink` row: `bookingId → activityId`

### Update Subscribers

| Subscriber | Event | Action |
|---|---|---|
| `booking-rescheduled.ts` | `cal_com.booking.rescheduled` | Load Activity via `CalComBookingLink`, update date/time |
| `booking-cancelled.ts` | `cal_com.booking.cancelled` | Update Activity status → `cancelled` |
| `no-show.ts` | `cal_com.booking.no_show` | Update Activity status → `no_show` |
| `meeting-ended.ts` | `cal_com.meeting.ended` | Update Activity status → `completed` |

### `CalComBookingLink` Entity

```
Table: cal_com_booking_links
Columns: id, booking_id (text), booking_uid (text), activity_id (uuid FK),
         organization_id, tenant_id, created_at, updated_at, deleted_at
Index: (booking_id, organization_id) UNIQUE
Index: (booking_uid, organization_id)
```

### Entity Extension (`data/extensions.ts`)

Declares a link from `cal_com:booking_link` → `customers.activity` so the booking link is surfaced as a cross-module data relationship.

### "Schedule Meeting" Widget

- Spot: injected into `customer:detail:actions` (person detail page action bar) and `customer:deal:actions` (deal detail page action bar) via `widgets/injection/`
- Note: `crud-form:*` spots are for form field injection only. Detail page action buttons use detail page binding spots (SPEC-041i).
- Renders a "Schedule Meeting" button opening `defaultBookingLink?email={person.email}&name={person.name}` in a new tab
- Hidden when `defaultBookingLink` is not configured

---

## Section 4: Contact Sync

### `CalComSyncLink` Entity

```
Table: cal_com_sync_links
Columns: id (uuid PK), om_person_id (uuid), cal_com_attendee_id (text),
         organization_id (uuid), tenant_id (uuid),
         created_at, updated_at, deleted_at
Index: (om_person_id, organization_id) UNIQUE
Index: (cal_com_attendee_id, organization_id)
```

Tracks the mapping between an OM Person and their corresponding cal.com attendee ID. Used by both the delta push subscriber and the full sync worker.

### Data Sync Adapter (`workers/contact-sync.ts`)

- Adapter ID: `cal_com`
- Source entity: `customers.person`
- Direction: OM → cal.com (push only; cal.com has no standalone contacts API, only attendees)
- Field mapping:

| OM field | cal.com attendee field |
|---|---|
| `name` | `name` |
| `email` | `email` |
| `phone` | `phoneNumber` |
| `timezone` | `timeZone` |

- Uses `CalComSyncLink` to track `person.id → cal.com attendeeId`
- Emits `progress.job.*` events for top-bar progress UX

### Delta Push Subscriber (`subscribers/person-sync-push.ts`)

- Events: `customers.person.created`, `customers.person.updated` (persistent)
- Pushes changed Person to cal.com immediately if:
  - Integration is enabled
  - Person has an email address
- Creates or updates the attendee profile via cal.com API
- Updates `CalComSyncLink` with returned attendee ID

### Full Sync Worker

- Triggered from the data_sync admin UI or on a configurable schedule
- Paginates all OM People with emails, upserts cal.com attendee profiles in batches
- Handles create/update via `CalComSyncLink` presence check

---

## Section 5: Customer Portal

### Portal Booking Page (`frontend/portal/book.tsx`)

- Route: `/portal/book`
- Auth: `requireCustomerAuth` — unauthenticated visitors redirected to portal login
- Renders an `<iframe>` pointing at `defaultBookingLink` with customer identity pre-filled:
  - `?email={customer.email}&name={customer.name}`
- When `defaultBookingLink` is not configured: renders a friendly empty state (no broken iframe)

> **Known limitation:** A single `defaultBookingLink` means all portal customers book the same event type. For teams using per-rep routing, configure a cal.com Routing Form URL as the `defaultBookingLink` — cal.com will route bookings to the correct host based on form answers.

### Portal Menu Injection

- Injects a "Book a Meeting" nav item into the portal sidebar
- Label key: `cal_com.portal.bookMeeting`
- Hidden when `defaultBookingLink` is not configured (widget checks credential at render time)

### CSP Requirement

The tenant's cal.com instance URL must be added to `frame-src` in the app's CSP configuration. This cannot be automated — the credential form `helpText` for `defaultBookingLink` calls this out explicitly with instructions.

---

## Integration Test Coverage

| Path | Test |
|---|---|
| `POST /api/webhooks/cal-com` | valid signature → 200 + event emitted |
| `POST /api/webhooks/cal-com` | invalid signature → 400 |
| `POST /api/webhooks/cal-com` | `BOOKING_CREATED` → Activity created, `CalComBookingLink` row created |
| `POST /api/webhooks/cal-com` | `BOOKING_RESCHEDULED` → Activity date updated |
| `POST /api/webhooks/cal-com` | `BOOKING_CANCELLED` → Activity status = cancelled |
| `POST /api/webhooks/cal-com` | `BOOKING_NO_SHOW_UPDATED` → Activity status = no_show |
| Contact sync worker | OM Person → cal.com attendee upserted, `CalComSyncLink` created |
| Delta push | `customers.person.created` → attendee pushed immediately |
| `GET /portal/book` | unauthenticated → redirect to portal login |

---

## Risks & Impact

| Risk | Severity | Mitigation |
|---|---|---|
| Webhook replay — same booking delivered twice | Medium | Deduplicate by `bookingId` in `CalComBookingLink` — insert is idempotent via UNIQUE constraint on `(booking_id, organization_id)` |
| Portal iframe blocked by CSP misconfiguration | Medium | Credential form `helpText` for `defaultBookingLink` includes exact CSP `frame-src` instructions; portal page shows a clear setup error when iframe fails to load |
| cal.com API key insufficient scope | Medium | Health check calls `GET /api/v2/me` and `GET /api/v2/attendees` — if attendee scope is missing, health check reports degraded and integration logs the missing scope |
| Duplicate Activity creation if subscriber runs twice | Low | `CalComBookingLink` UNIQUE constraint on `(booking_id, organization_id)` prevents duplicate rows; subscriber checks for existing link before creating Activity |
| Self-hosted cal.com API differences | Low | `baseUrl` is configurable; spec assumes v2 API parity — document that older self-hosted versions may not support all attendee endpoints |

---

## Migration & Backward Compatibility

New package — no breaking changes to existing surfaces. The `cal_com` module ID, event IDs, and widget spot IDs are new frozen contracts from this release.
