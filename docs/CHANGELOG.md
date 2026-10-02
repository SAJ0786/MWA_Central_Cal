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

## Batch: app rename, timezone/DST fix, venue/department edit UI, confirmed-booking visibility, sign-in redesign, dialog close button

**Requested by user** (timezone clarified as Australia/Sydney civil time — AEST in
southern winter, AEDT during daylight saving):

1. **App renamed throughout** from "Community Hub Calendar" to **"MWA Central
   Calendar"** — page `<title>`, headings, `package.json`/`package-lock.json` names
   (both app and `functions/`), iCal feed `PRODID`, README, `docs/EMAIL_SETUP.md`
   example. **Deliberately left unchanged:** the iCal `UID` domain suffix
   (`...@community-hub-calendar`, in both `src/services/exportService.js` and
   `functions/index.js`'s `icalFeed`) — changing it would make every previously-synced
   event look "new" to anyone already subscribed to the public iCal feed, duplicating
   their calendar; documented inline at both call sites. The historical prototype/brief
   filename is also left as-is (provenance, not a live app string).
2. **Fixed a real booking-time-shift bug** (e.g. a 12:00–16:00 Sydney booking showing/
   saving as a different clock time): two separate bugs, found by grep for host-local
   `Date#getHours/getMinutes`/un-zoned `toLocaleTimeString` calls applied to stored UTC
   instants:
   - `src/components/BookingModal.jsx`'s `isoTime()` (edit-form time prefill) and the
     editing-date prefill in `emptyForm()` read the **browser's own system timezone**
     instead of Sydney — on a non-Sydney-timezone browser this pre-filled the wrong
     time-of-day/date when opening a booking to edit, and if saved without the admin
     manually correcting it, the (already-correct) `localToUtcIso` would re-interpret
     that wrong time as Sydney-local, persisting a genuinely shifted UTC instant. Fixed
     by adding `timeKeyInOrgTz`/`toOrgTimeParts` to `src/utils/dateUtils.js` (the client
     twin of the existing server-side `toOrgTimeParts`) and using them instead of
     `Date#getHours/getMinutes`/`.toISOString().slice(0,10)`.
   - `src/pages/CalendarPage.jsx`'s per-event time label omitted `timeZone:
     'Australia/Sydney'` entirely, also falling back to host-local time. Fixed to use
     `timeKeyInOrgTz`.
   - **A second, independent bug found via the new DST regression test:**
     `localToUtcIso` (both `functions/dateUtils.js` and `src/utils/dateUtils.js`) used a
     single-pass offset lookup that reads the target zone's AEST/AEDT offset at a
     *naive* UTC stand-in for the wall-clock time being converted — within a few hours
     of a DST transition, that stand-in instant can land on the other side of the
     transition from the real target instant, picking the wrong offset and silently
     shifting the result by an hour (reproduced: requesting Sydney "2026-10-03 20:00",
     the evening before Sydney's 2026 DST start, round-tripped to "19:00"). Fixed with a
     two-pass fixed-point offset resolution (re-reads the offset at the first pass's
     result) in both copies.
   - `BookingModal.jsx`'s Hijri-basis Gregorian-equivalent preview also built an
     un-zoned `"YYYY-MM-DDT12:00:00"` string (host-local interpretation risk at extreme
     UTC offsets); now built via `localToUtcIso(gregorianDate, '12:00')` instead.
   - **New tests:** `functions/dateUtils.test.js` — AEST-only, AEDT-only, and
     DST-transition-straddling cases for `localToUtcIso`/`toOrgTimeParts`, plus the
     host-timezone-independence case for `toOrgTimeParts`. (The client's
     `src/utils/dateUtils.js` ports the identical algorithm but can't be unit-tested
     directly via `node --test` — it imports Vite's `import.meta.env` — so this suite is
     the regression source of truth for both.)
   - **Verified, no change needed:** the admin edit/review conflict-check path
     (`updateBooking`'s `findOverlaps` call) already resolves and applies the venue's
     post-booking `bufferHours` consistently with `submitBooking`/`decideBooking`/the
     REST endpoints (shared `rangesOverlapBuffered`, strict `<`/`>` boundary — a
     candidate starting exactly at the buffered end is correctly **not** flagged as a
     conflict), so an admin rescheduling a conflicted pending booking to a
     non-overlapping slot already gets an accurate, non-blocking conflict flag.
3. **Venues and Departments admin tabs gained inline Edit**, not just add/delete/active
   toggle — `src/pages/AdminPage.jsx`'s `VenuesTab`/`DepartmentsTab` now have an "Edit"
   button per row that switches that row to editable inputs (name, capacity, buffer
   hours, opening hours for venues; name, colour for departments) with Save/Cancel,
   writing through the existing `updateVenue`/`updateDepartment` in
   `src/services/directoryService.js` (already present, already admin-only per
   `firestore.rules`). IDs/other fields are preserved; no new Firestore audit-log entries
   are written for these edits (the existing convention only audits Cloud-Function-driven
   writes to `events`, not direct client writes to `venues`/`departments`).
4. **Confirmed/approved bookings' visibility is now clearly reachable in the Admin
   area**, not only via the public Calendar/Bookings tabs: a new "Confirmed bookings"
   admin tab (`ConfirmedTab` in `AdminPage.jsx`) lists every confirmed booking with its
   current visibility and an "Edit" button opening the same `BookingModal`, whose
   Visibility selector was already general-purpose and admin-editable regardless of
   status (verified: `updateBooking`'s `visibility` patch and the selector's `disabled`
   condition only restrict *non-admin* edits of an existing booking). The public
   endpoint/iCal export are unchanged and still gate strictly on
   `status === 'confirmed' && visibility === 'public'`.
5. **Admin sign-in screen redesigned** (user said the prior polish pass "still looks
   bad") — a split hero/form layout (`src/pages/AdminPage.jsx`'s `LoginCard` + new
   `.login-shell`/`.login-hero`/`.login-form-area`/`.field`/`.spinner` CSS): a
   brand-gradient header band with icon/title, a distinct form section with
   labelled fields, visible focus rings, an inline spinner + "Signing in…" label as an
   explicit loading state, a styled error banner, and mobile-responsive padding. No
   change to the `login`/`logout` calls or field semantics/`required` attributes.
6. **Booking dialog close button replaced** with an accessible "✕" icon button
   top-right of `BookingModal.jsx` (`aria-label="Close dialog"`, `dlg-close` styling,
   keyboard-focusable). Escape-to-close and click-outside-the-dialog-to-close were not
   previously implemented; both were added alongside the button (a `keydown` listener
   while open, and an `onClick` on the overlay with `stopPropagation` on the dialog
   itself) since "preserve escape/other close behaviours" implied they were expected to
   exist.

**Checks run:** `node --test` in `functions/` — 16/16 pass (11 pre-existing + 5 new
`dateUtils.test.js` cases, including the DST-edge-case test that caught the
`localToUtcIso` bug above before it shipped); `node --test "src/utils/*.test.js"` — 6/6
pass (unchanged); `npm run build` (frontend) — clean.

**Docs:** this entry. No data-model/API shape changes in this batch (visibility/buffer
rules were already documented; the timezone fix and edit-UI additions don't change the
wire format).

**Git/deploy outcome:** see the dated entry immediately below for the exact commit hash,
push result, and deploy result.



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
