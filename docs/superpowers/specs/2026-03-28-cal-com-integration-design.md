# cal.com Integration Design

**Date**: 2026-03-28
**Package**: `@open-mercato/cal-com`
**Module ID**: `cal_com`
**Workspace path**: `packages/cal-com/`

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
- `hub`: `scheduling` (new hub, declared by this provider)
- `healthCheck.service`: `calComHealthCheck` (calls `GET /api/v2/me`)

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

---

## Section 2: Events & Webhook Handler

### Typed Events (`events.ts`)

All events have `clientBroadcast: true` for workflow engine visibility.

| Event ID | Label | cal.com Webhook Type |
|---|---|---|
| `cal_com.booking.created` | Booking Created | `BOOKING_CREATED` |
| `cal_com.booking.rescheduled` | Booking Rescheduled | `BOOKING_RESCHEDULED` |
| `cal_com.booking.cancelled` | Booking Cancelled | `BOOKING_CANCELLED` |
| `cal_com.booking.no_show` | Attendee No-Show | `BOOKING_NO_SHOW_UPDATED` |
| `cal_com.meeting.ended` | Meeting Ended | `MEETING_ENDED` |

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
| `meeting-ended.ts` | `cal_com.meeting.ended` | Update Activity status → `completed` |

### `CalComBookingLink` Entity

```
Table: cal_com_booking_links
Columns: id, booking_id (text), booking_uid (text), activity_id (uuid FK),
         organization_id, tenant_id, created_at, updated_at, deleted_at
Index: (booking_id, organization_id)
Index: (booking_uid, organization_id)
```

### Entity Extension (`data/extensions.ts`)

Declares a link from `cal_com:booking_link` → `customers.activity` so the booking link is surfaced as a cross-module data relationship.

### "Schedule Meeting" Widget

- Spot: injected into `crud-form:customers.person` and `crud-form:customers.deal` pages (as a panel, not a field)
- Renders a "Schedule Meeting" button opening `defaultBookingLink?email={person.email}&name={person.name}` in a new tab
- Hidden when `defaultBookingLink` is not configured

---

## Section 4: Contact Sync

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

- Uses `SyncExternalIdMapping` to track `person.id → cal.com attendeeId`
- Emits `progress.job.*` events for top-bar progress UX

### Delta Push Subscriber (`subscribers/person-sync-push.ts`)

- Events: `customers.person.created`, `customers.person.updated` (persistent)
- Pushes changed Person to cal.com immediately if:
  - Integration is enabled
  - Person has an email address
- Creates or updates the attendee profile via cal.com API
- Updates `SyncExternalIdMapping` with returned attendee ID

### Full Sync Worker

- Triggered from the data_sync admin UI or on a configurable schedule
- Paginates all OM People with emails, upserts cal.com attendee profiles in batches
- Handles create/update via `SyncExternalIdMapping` presence check

---

## Section 5: Customer Portal

### Portal Booking Page (`frontend/portal/book.tsx`)

- Route: `/portal/book`
- Auth: `requireCustomerAuth` — unauthenticated visitors redirected to portal login
- Renders an `<iframe>` pointing at `defaultBookingLink` with customer identity pre-filled:
  - `?email={customer.email}&name={customer.name}`
- When `defaultBookingLink` is not configured: renders a friendly empty state (no broken iframe)

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
| Contact sync worker | OM Person → cal.com attendee upserted, `SyncExternalIdMapping` created |
| Delta push | `customers.person.created` → attendee pushed immediately |
| `GET /portal/book` | unauthenticated → redirect to portal login |

---

## Migration & Backward Compatibility

New package — no breaking changes to existing surfaces. The `cal_com` module ID, event IDs, and widget spot IDs are new frozen contracts from this release.
