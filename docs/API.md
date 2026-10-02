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

- **Unauthenticated / non-admin callers** always get only `visibility=public` AND
  `status=confirmed` events, with `contactName`/`contactEmail`/`contactPhone`/`notes`
  stripped and a resolved `hijri` object added:
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
- **Authenticated admins** get the full document for every matching event (any status/
  visibility), including contact details and `hasConflict`/`conflictWith`.

## `POST /v1/events`

Public — submits a booking request. Body: `title`, `departmentId`, `venueId`, `startAt`,
`endAt`, `contactName`, `contactEmail`, optional `contactPhone`, `notes`,
`dateBasis` (`"g"`/`"h"`), `hijriDate`, `requestPublicListing`.

- `201 { "id": "...", "status": "pending", "hasConflict": false }` — **always created as
  Pending**; an overlap at the same venue is flagged in `hasConflict`/`conflictWith` but
  **never rejected**, per the brief's conflict-handling requirement. Overlap detection
  honours each venue's `bufferHours` (applied only after an *existing* booking's end —
  see docs/DATA_MODEL.md); the buffer never blocks the incoming submission itself.
- `400` for missing fields / invalid time range. `404` if `venueId`/`departmentId` don't
  exist.

## `PATCH /v1/events/:id/status`

Admin only. Body: `{ "status": "confirmed" | "rejected" | "cancelled", "visibility"?: "public"|"private", "note"?: string }`.
Confirming an event re-checks for conflicts and sets `visibility` (defaults to
`private` if omitted — see docs/DATA_MODEL.md's visibility decision). Writes an audit log
entry and best-effort emails the requester.

## `GET /v1/availability?venue=<id>&date=<YYYY-MM-DD>`

Public. Returns the busy windows (pending + confirmed bookings) for that venue on that
calendar day, for building an availability view without exposing booking details. These
are the raw booked windows (not extended by the venue's `bufferHours`) — it's an
informational display feed, not the conflict-detection rule used by `hasConflict`:
```json
{ "venue": "main-hall", "date": "2026-10-12", "busy": [{ "start": "...", "end": "...", "status": "confirmed" }] }
```

## `GET /ical`

Public live iCal feed (`text/calendar`) of all `public` + `confirmed` events — subscribe
to it from Google Calendar/Outlook. Served by the `icalFeed` function, not under `/v1`.

## Known limitations (MVP)

- No webhooks yet (brief lists them as a near-term follow-on, not MVP-blocking).
- No API-key auth for server-to-server integrations — only Firebase ID tokens for admins.
- No pagination on `GET /v1/events` — fine at MVP data volumes, revisit before it grows.
- No OpenAPI/Swagger document yet; this file is the canonical contract for now.
