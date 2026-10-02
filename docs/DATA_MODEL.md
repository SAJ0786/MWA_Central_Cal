# Data model

All collections live in the default Firestore database. Timestamps are stored as ISO 8601
UTC strings (`startAt`/`endAt`) or Firestore server timestamps (`createdAt`, etc.); the UI
always renders them in the organisation timezone, `Australia/Sydney`.

## `events` (bookings)

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `departmentId` | string | ref `departments/{id}` |
| `departmentName` | string | denormalized at write time for fast lists/exports |
| `venueId` | string | ref `venues/{id}` |
| `venueName` | string | denormalized |
| `startAt`, `endAt` | string (ISO UTC) | canonical Gregorian range used for conflict checks, iCal and the REST API |
| `status` | `pending` \| `confirmed` \| `rejected` \| `cancelled` | workflow: Pending → Confirmed/Rejected, or Cancelled from either |
| `visibility` | `private` \| `public` | **default `private`**; only ever set to `public` by an admin at confirm time (see Visibility decision below) |
| `requestedVisibility` | `private` \| `public` | the requester's preference, for the admin's reference only — never authoritative |
| `dateBasis` | `gregorian` \| `hijri` | how the requester entered the date |
| `hijriDate` | `{day, month, year}` \| null | source Hijri date if `dateBasis = hijri`; re-resolved to `startAt`/`endAt` at submission time using the current moon-sighting adjustment |
| `hasConflict` | boolean | true if another pending/confirmed booking at the same venue overlaps; **never blocks submission or confirmation** |
| `conflictWith` | string[] | ids of the overlapping booking(s) |
| `contactName`, `contactEmail`, `contactPhone` | string | never exposed to public reads |
| `notes` | string | never exposed to public reads |
| `createdByUid` | string \| null | null for public (unauthenticated) submissions |
| `createdAt`, `updatedAt` | server timestamp | |
| `decidedBy`, `decidedByEmail`, `decidedAt`, `decisionNote` | | set by `decideBooking` |

### Visibility decision

The brief asked for a safe default with the option of an explicit approval-time decision.
This MVP does both: every booking is created `visibility: private`, and an admin can only
switch it to `public` as part of confirming it (`decideBooking` with `visibility: 'public'`).
Private hire details are therefore never visible publicly, and nothing becomes public
without an explicit admin action at the moment it's confirmed.

## `venues`

`name`, `capacity`, `hireable`, `openingHours`, `bufferMinutes`, `active`. Public read
(needed for the booking form), admin write.

## `departments`

`name`, `colorHex`, `approvalRequired`, `active`. Public read, admin write.

> Note: the prototype also had a "Department user" login role that could create/edit its
> own department's bookings while signed in. The confirmed MVP scope only specifies
> **public submit (no sign-in)** and **admin sign-in**, so that role was not built. Adding
> it later is additive: a `role: departmentUser` + `departmentId` on `users/{uid}`, rules
> allowing writes scoped to that department, and a sign-in-gated version of the booking
> form.

## `users`

`{uid}` doc: `email`, `role` (`admin` in this MVP), `name` (optional). Created by an
existing admin or manually in the console — see docs/SETUP.md.

## `calendarSettings/hijri`

`overrides: [{ hYear, hMonth, gDate }]` — the moon-sighting anchors used by
`hijriService.js`'s tabular+override algorithm (ported unchanged from
`community-events-app`). `adjustedBy`, `updatedAt` record who last changed it, for the
audit trail. Public read (needed to render correct Hijri dates for guests), admin write.

## `auditLog`

`entityType`, `entityId`, `action` (`submitted`, `status_confirmed`, `status_rejected`,
`status_cancelled`, `updated`), `userId`, `userEmail`, `note`, `diff`, `timestamp`.
Written only by Cloud Functions (Admin SDK) — never directly by clients. Admin read only.
