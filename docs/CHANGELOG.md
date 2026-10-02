# Changelog / process notes

Lightweight, append-only record of user-requested changes made after the initial MVP
build + deploy, and any explicit process directives from the user that affect how future
changes are handled (e.g. deploy/push timing). Not a full release changelog — see git
history for that; this is for the specific instructions that aren't obvious from a diff.

## Process directive: no deploy during iterative changes (active)

The user asked that, while they're sending a series of follow-up change requests, each
change should be **implemented and validated but not deployed to Firebase**, and that
Firebase deploys should wait until the user confirms all changes for this batch are
complete. Commit/push to GitHub is allowed when the user has explicitly asked for it (as
part of a specific request) or there's a clear repo-workflow need, but is otherwise also
held back during this period rather than assumed from the original MVP push/deploy
authorization.

**Current status:** no `firebase deploy` has been run since this directive was given.
Changes below are implemented, linted, and tested locally only, pending the user's
go-ahead to push/deploy.

## 2024 — Venue buffer: minutes → hours, post-booking-only

**Requested by user:** venue buffer should be expressed in **hours** (fractional allowed,
e.g. `0.5`), and should apply **only after** a booking ends — i.e. an existing active
booking occupies `[startAt, endAt + bufferHours]` for conflict-detection purposes. A
same-venue/time overlap must still never block a new submission (unchanged "flag, don't
block" behaviour) — only `hasConflict`/`conflictWith` reflects the buffered occupancy.

**What changed:**
- `functions/conflictUtils.js` (new): extracted, dependency-free `resolveBufferHours` and
  `rangesOverlapBuffered` helpers, covered by `functions/conflictUtils.test.js`
  (`node --test`, 7 cases: legacy-field fallback, zero buffer, buffer boundary,
  fractional hours, one-directional buffer).
- `functions/index.js`: `findOverlaps` now applies the venue's buffer to each *existing*
  active booking's end only (never to the incoming candidate range), via
  `rangesOverlapBuffered`. Every call site that checks for conflicts
  (`submitBooking`, `decideBooking`, `updateBooking`, REST `POST /v1/events`, REST
  `PATCH /v1/events/:id/status`) now resolves and applies the venue's buffer
  consistently. `GET /v1/availability` intentionally still reports raw (unbuffered) busy
  windows — it's an informational display feed, not the conflict rule; documented in
  docs/API.md.
- `src/pages/AdminPage.jsx`: venue admin form/table renamed `bufferMinutes` →
  `bufferHours`, label now "Buffer (hours, after booking)", input allows fractional
  values (`step="0.25"`). Table display uses a read-time fallback
  (`resolveVenueBufferHours`) for safe migration of older docs.
- `src/services/directoryService.js`: `createVenue` now writes `bufferHours` instead of
  `bufferMinutes`.
- `docs/DATA_MODEL.md`, `docs/SETUP.md`, `docs/API.md`: updated field name, documented the
  post-booking-only buffer semantics, and the backward-compatible read fallback.

**Migration:** no destructive Firestore migration was run or is required. Every read path
resolves `bufferHours` first, falls back to converting a legacy `bufferMinutes` value
(`/ 60`), and defaults to `0` — safe indefinitely, documented in docs/DATA_MODEL.md. (No
venues are currently seeded in the live database, so there's nothing to actively migrate
yet regardless.)

**Checks run:** `node --check` on all `functions/*.js` (via `npm run lint` in
`functions/`), `node --test` in `functions/` (7/7 pass), `npm run build` (frontend, clean
build). No Firebase deploy was performed for this change, per the active no-deploy
directive above.
