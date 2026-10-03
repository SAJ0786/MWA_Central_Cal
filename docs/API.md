# REST API (`/v1`)

Versioned HTTP endpoints served by the `api` Cloud Function, mounted at `/v1/*` via
Hosting rewrites once deployed (`https://<your-domain>/v1/...`). This is the MVP surface
described in the brief's "API-first" requirement — it is deliberately small; see
**Known limitations** below.

All request/response bodies are JSON. Dates are ISO 8601 UTC strings.

## Authentication

Public endpoints need no auth. Admin-only actions require a Firebase **ID token** (not
the API key) in the `Authorization: Bearer <idToken>` header, for a user whose
`users/{uid}.role == "admin"`. Obtain an ID token client-side via
`firebase.auth().currentUser.getIdToken()` after signing in.

## `GET /v1/events`

Query params: `from`, `to` (ISO date/time, inclusive bounds on `startAt`), `venue`
(venueId), `department` (departmentId), `status` (admin only — ignored for guests).

- **Unauthenticated / non-admin callers** get a **sanitized projection** (never the raw
  document). Only `confirmed` and `pending` bookings are returned (`rejected`/`cancelled`
  are hidden). `confirmed` + `visibility=public` events are returned in full minus
  `contactName`/`contactEmail`/`contactPhone`/`notes`; **private** confirmed events are
  masked (`title: "Private"`) and **pending** events are masked (`title: "Unconfirmed
  booking"`) regardless of visibility. A masked item contains only `id`, `status`,
  `startAt`, `endAt`, `venueId`, `venueName`, `dateBasis`, `hijri`, `title`, `masked: true`
  — no department, contact, notes, visibility or conflict data. Full example:
  ```json
  { "events": [{
      "id": "evt_123", "title": "Diwali Community Night",
      "departmentId": "eo", "departmentName": "Event Organisers",
      "venueId": "main-hall", "venueName": "Main Hall",
      "startAt": "2026-10-12T06:00:00.000Z", "endAt": "2026-10-12T10:00:00.000Z",
      "status": "confirmed", "visibility": "public", "dateBasis": "gregorian",
      "hijri": { "day": 1, "month": 5, "monthName": "Jumada al-Awwal", "year": 1448 }
  }] }
  ```
  A masked item looks like `{ "id": "evt_9", "status": "pending", "title": "Unconfirmed booking", "masked": true, "venueId": "main-hall", "venueName": "Main Hall", "startAt": "...", "endAt": "...", "hijri": { ... } }`.
- **Authenticated admins** get the full document for every matching event (any status/
  visibility), including contact details and `hasConflict`/`conflictWith`.

## `POST /v1/events`

Public (or admin, with an `Authorization: Bearer <token>`) — submits a booking request.
Body: `title`, `departmentId`, `venueId`, `startAt`, `endAt`, `contactName`,
`contactEmail`, optional `contactPhone`, `notes`, `dateBasis` (`"g"`/`"h"`), `hijriDate`,
optional `visibility` (`"public"`/`"private"`).

- `201 { "id": "...", "status": "pending", "hasConflict": false }` — **always created as
  Pending**; an overlap at the same venue is flagged in `hasConflict`/`conflictWith` but
  **never rejected**, per the brief's conflict-handling requirement. Overlap detection
  honours each venue's `bufferHours` (applied only after an *existing* booking's end —
  see docs/DATA_MODEL.md); the buffer never blocks the incoming submission itself.
- `visibility` defaults to `public` for an unauthenticated (public) submission and to
  `private` for an authenticated admin submission if not explicitly given — see
  docs/DATA_MODEL.md's visibility decision. A pending booking is shown publicly only as a masked
  "Unconfirmed booking" item regardless of this flag.
- `400` for missing fields / invalid time range. `404` if `venueId`/`departmentId` don't
  exist.

## `PATCH /v1/events/:id/status`

Admin only. Body: `{ "status": "confirmed" | "rejected" | "cancelled", "visibility"?: "public"|"private", "note"?: string }`.
Confirming an event re-checks for conflicts. `visibility` only changes if explicitly
given; otherwise the booking's existing visibility (set at submission, or by a prior
admin edit) is preserved unchanged — see docs/DATA_MODEL.md's visibility decision. Writes
an audit log entry and best-effort emails the requester.

## `PATCH /v1/events/:id` (via the `updateBooking` callable from the app)

Admin only. General edit of a booking's core fields, including `visibility`
(`"public"`/`"private"`) — an admin may change visibility at any time, independent of
status. Every visibility change is recorded in the audit log.

## Callables (admin only, not exposed under `/v1`)

- `createRecurringBooking` — body: `title`, `departmentId`, `venueId`, `contactName`,
  `contactEmail`, optional `contactPhone`/`notes`, `status` (`confirmed` default | `pending`),
  `visibility` (default `private`), and `recurrence`:
  `{ basis: "gregorian"|"hijri", startDate | hijriStart{day,month,year}, startTime, endTime,
  frequency: "day"|"week"|"month"|"year", repeatEvery (1-100), endMode: "count"|"date",
  count, endDate }`. Expanded server-side in Australia/Sydney civil time (DST-safe). Limits:
  at most 370 occurrences, a 1-year horizon (yearly: 5 occurrences). Overlaps (venue
  `bufferHours` aware) are flagged per occurrence, never blocked. Returns
  `{ seriesId, created, conflicts, status }`.
- `updateBooking` accepts `scope`: `single` (default) | `future` | `all`. For `future`/`all`
  shared fields and the time of day are applied to each occurrence (each keeps its own date);
  changing the date is only allowed for `single`.
- `deleteBooking` `{ eventId, scope }` — hard delete of one occurrence, this and following, or
  the whole series; one audit entry per deleted booking.

## `GET /v1/availability?venue=<id>&date=<YYYY-MM-DD>`

Public. Returns the busy windows (pending + confirmed bookings) for that venue on that
calendar day, for building an availability view without exposing booking details. These
are the raw booked windows (not extended by the venue's `bufferHours`) — it's an
informational display feed, not the conflict-detection rule used by `hasConflict`:
```json
{ "venue": "main-hall", "date": "2026-10-12", "busy": [{ "start": "...", "end": "...", "status": "confirmed" }] }
```

## `GET /ical`

Public live iCal feed (`text/calendar`) of confirmed events (public ones in full, private ones as
`Private`) and pending ones as `Unconfirmed booking` with `STATUS:TENTATIVE` — no contact,
notes or department data. Subscribe to it from Google Calendar/Outlook. Served by the `icalFeed` function, not under `/v1`.

## Known limitations (MVP)

- No webhooks yet (brief lists them as a near-term follow-on, not MVP-blocking).
- No API-key auth for server-to-server integrations — only Firebase ID tokens for admins.
- No pagination on `GET /v1/events` — fine at MVP data volumes, revisit before it grows.
- No OpenAPI/Swagger document yet; this file is the canonical contract for now.

## Callables added (batch A–H)

| Callable | Caller | Purpose |
|---|---|---|
| `checkSlotConflicts {venueId,startAt,endAt,excludeId?}` | public | `{hasConflict,count}` only; admins also get `conflicts[]` (id,title,status,startAt,endAt,departmentName,contactName,visibility) |
| `previewRecurringBooking` | admin | Same input as `createRecurringBooking`; returns `{count,conflicts,occurrences[]}` without writing |
| `importBookings {rows,dryRun}` | admin | Validates (max 500 rows) and, when `dryRun` is false, writes; returns counts, row errors, warnings |
| `recomputeAllConflicts` | admin | Repairs stored `hasConflict`/`conflictWith` for all venues |

`deleteBooking` now keeps bookings that have already started (single: rejected; series scopes: only upcoming occurrences deleted, `kept` returned).

> importBookings row dates: DD/MM/YYYY (Gregorian or Hijri per the row's `Date Basis` = Gregorian|Hijri, default Gregorian). Hijri rows are stored with `dateBasis: hijri` and `hijriDate`.
