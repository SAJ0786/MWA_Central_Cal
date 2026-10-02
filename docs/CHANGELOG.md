# Changelog / process notes

Lightweight, append-only record of user-requested changes made after the initial MVP
build + deploy, and any explicit process directives from the user that affect how future
changes are handled (e.g. deploy/push timing). Not a full release changelog — see git
history for that; this is for the specific instructions that aren't obvious from a diff.

## Process directive: no deploy during iterative changes (lifted)

The user asked that, while they're sending a series of follow-up change requests, each
change should be **implemented and validated but not deployed to Firebase**, and that
Firebase deploys should wait until the user confirms all changes for this batch are
complete. Commit/push to GitHub is allowed when the user has explicitly asked for it (as
part of a specific request) or there's a clear repo-workflow need, but is otherwise also
held back during this period rather than assumed from the original MVP push/deploy
authorization.

**Status:** this directive is now **lifted** — the user explicitly said "now implement
everything and deploy and push to git" once the batch below was ready. See the entry
below for exactly what was pushed/deployed and when.

## Batch: Hijri source-date anchoring, calendar primary-toggle, visibility control, submit-lock, sign-in polish

**Requested by user, across several follow-up messages (implemented under the no-deploy
directive above, then pushed/deployed once it was lifted):**

1. **Hijri source-date preservation.** A Hijri-based booking's `hijriDate {day,month,year}`
   is now the durable source of truth; its resolved `startAt`/`endAt` is (re)computed
   server-side from the current moon-sighting overrides — at submission (`submitBooking`,
   REST `POST /v1/events`) and whenever an admin changes the Hijri overrides (new
   Firestore trigger `onHijriSettingsChanged`, batched). A Gregorian-based booking never
   moves; only its *displayed* Hijri equivalent is recomputed on the fly. An admin's own
   explicit date/time edit (`updateBooking`) that diverges from the current Hijri
   resolution detaches the booking to `dateBasis: 'gregorian'` (one-way) so it's never
   silently moved again after a deliberate manual reschedule.
   - New: `functions/hijriRecompute.js` (`resolveBookingDates`) + its tests; `functions/dateUtils.js`
     (`toOrgTimeParts`, `localToUtcIso`); `functions/hijriService.js` gained
     `jdnToGregorian`/`getHijriMonthLength`/`adjustedIslamicToGregorian`.
   - **Bug fixed along the way:** `localToUtcIso` (both `functions/` and `src/utils/`
     copies) only converted correctly when the *host process's own* system timezone was
     UTC — true for Cloud Functions, false on a Sydney-timezone dev machine, where it
     silently no-op'd. Rewritten to be timezone-independent (`Intl.DateTimeFormat`
     against the explicit `Australia/Sydney` zone), verified by test.
2. **Calendar primary-toggle & responsive grid.** `src/utils/hijriCalendarGrid.js` (new,
   tested — 6 cases) builds a month grid from either calendar outward: Gregorian-primary
   (28–31 days) or Hijri-primary (29/30 days, varying with overrides), not by relabeling a
   fixed Gregorian month. `src/pages/CalendarPage.jsx` rewritten: a Gregorian/Hijri segmented
   toggle drives navigation and in-cell day numbering; every cell always shows both date
   forms; weekday columns/order are unchanged by the toggle (per the user's instruction).
   `src/styles.css`: calendar grid is now fluid (`clamp()`-sized cells, wider `main`,
   mobile/desktop media-query tuning) instead of a fixed max-width.
3. **Booking visibility is now admin-editable at any time**, not only at confirm. Public
   submissions default `visibility: public` (safe — pending bookings are hidden from all
   public reads/feeds regardless, via the existing `status === 'confirmed'` gate); an
   admin-created booking defaults `private`. `decideBooking`/REST status-patch now only
   change visibility if one is explicitly given (previously silently reset to `private`
   unless `public` was passed at confirm time — a real behaviour fix, not just an
   addition). `updateBooking` accepts `visibility` with its own audit diff entry.
   `src/components/BookingModal.jsx` gained a single Visibility selector used consistently
   everywhere (replacing the old "request a public listing" checkbox + separate
   confirm-time selector).
4. **Submit-disable-after-success.** The booking form's submit button disables after a
   *successful* submission/save and re-enables the instant any field is edited; a failed
   attempt stays immediately retryable. Confirm/Reject/Cancel/Close are unaffected.
5. **Admin sign-in screen polish.** `LoginCard` in `src/pages/AdminPage.jsx` restyled
   (centred card, subtle shadow, clearer heading/subtext, full-width submit, focus
   outline) — no change to the `login`/`logout` calls, field semantics, `required`
   attributes, or accessibility (labels now explicitly associated via `htmlFor`/`id`,
   `role="alert"` added to the error message).

**Checks run:** `node --test` in `functions/` (11/11 pass, including the 4 new
`hijriRecompute` cases); `node --test` on `src/utils/hijriCalendarGrid.test.js` (6/6
pass, new); `npm run build` (frontend, clean build, twice — once after the component
rewrites, once after the CSS/login polish).

**Docs updated:** `docs/DATA_MODEL.md` (Hijri anchoring/recompute rule, corrected the
previous "resolved once at submission" claim; visibility default-by-role rule), `docs/API.md`
(visibility defaults on `POST /v1/events`, `PATCH /v1/events/:id/status` preserve-unless-
explicit rule, new `updateBooking` visibility note).

**Git/deploy outcome:** see the dated entry immediately below this one for the exact
commit hash, push result, and deploy result once that step was performed.


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
