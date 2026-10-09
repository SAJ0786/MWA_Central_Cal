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

## Batch: read-only booking detail, masked public calendar, recurring bookings, delete

**Requested by user** (implemented and tested; push/deploy authorised afterwards):

1. **Read-only detail.** Opening a booking from the calendar shows all fields disabled for
   everyone; admins get an **Edit** button (then Save/Cancel). Non-admins have no Edit.
2. **Private bookings visible publicly, masked**: title "Private"; general users see only
   date/time, venue and Hijri date. Admins see everything and can toggle visibility.
3. **Pending bookings visible publicly as "Unconfirmed booking"** (visually distinct). General
   users see date/time/venue only. Admins see full details with Edit, Approve, Reject, Cancel
   and the new **Delete**. This **intentionally supersedes** the earlier rule that
   pending/private bookings are hidden from public feeds: `getPublicEvents`, `GET /v1/events`
   and the iCal feed now return a whitelist projection (no contact, notes, department,
   visibility or conflict details). Raw event docs remain admin-only in `firestore.rules`.
   Rejected/cancelled stay hidden. iCal uses masked titles; pending is `STATUS:TENTATIVE`.
4. **Recurring bookings** (admin only: `createRecurringBooking`, scoped `updateBooking`,
   `deleteBooking`), modelled on `SAJ0786/CommunityEvents-Native` (day/week/month/year,
   every N, end by count or date, scopes this / this and following / all, Hijri-based
   recurrence, 1-year horizon, 370-occurrence cap, yearly max 5).

**Design decisions / assumptions**
- Expansion is server-side, Australia/Sydney civil time, DST-safe (`functions/recurrence.js`).
  Gregorian month steps are computed from the first date (no drift); Hijri month/year steps
  clamp to the real month length; Hijri-anchored occurrences follow the existing anchoring rule.
- Admin-created series default to **confirmed + private**; "pending" is selectable.
- Hijri-based series take a Gregorian end date (no Hijri end date); no client-side preview.
- Per-occurrence conflicts use the same buffer-hours rule and are flagged, never blocked.
- Editing several occurrences applies shared fields and time of day only; changing the date is
  single-occurrence only (otherwise delete and recreate).
- Delete is a hard delete with an audit entry per booking. Deleting/cancelling does not
  recompute other bookings' stale `hasConflict` flags (pre-existing behaviour).
- Recurring create/delete are callables only (not in REST `/v1`).
- Tests: `functions/recurrence.test.js`, `functions/publicProjection.test.js`.

## Batch: stale conflict flags, live conflicts, series preview, all day/night, Excel (A–H)

Root cause of "no conflict shown" (Main Hall: Boys Cricket 10:30–15:00 confirmed vs Public
Speaking Seminar 16:00–20:00 pending): the venue buffer is **genuinely 3 hours** (live doc has
`bufferHours: 3`; a junk legacy `bufferMinutes: 3` is ignored because `bufferHours` wins), so
Cricket occupies 10:30–18:00 and the seminar does conflict. `hasConflict` was only computed for
the booking being submitted/edited at that moment, never recomputed for the *other* bookings, so
a booking created/confirmed/imported earlier, or a buffer changed later, left stale flags.
Fixes: conflict rule is now **symmetric** (each active booking occupies `[start, end + buffer]`;
a pair conflicts if either one's occupancy overlaps the other's booked time; strict bounds, so a
start exactly at end + buffer is clear); the server recomputes stored flags for the venue after
every submit/decision/update/series create/delete/import; admins get a **Recalculate conflicts**
button (callable `recomputeAllConflicts`) to repair existing data.

- A. Series: admin-created series default to Confirmed; visibility is whatever the admin selects
  (server falls back to public only if omitted). Time-of-day edits apply to remaining
  occurrences; occurrences that have already started are never modified by "this and following" / "all".
- B. Retention: nothing auto-purges. Bookings are never limited by age; Bookings page has From/To
  filters ("Last 2 years +", "All time"). A booking that has already started cannot be hard-deleted
  (cancel it instead). Deleting a series with "this and following"/"all" deletes only upcoming
  occurrences; past ones are kept and reported (`kept`).
- C. New (public) booking form has a **Clear form** button; no post-submit delete for public users.
- D. Series creation is two-step: **Preview series** (callable `previewRecurringBooking`) shows the exact
  count, each date incl. Hijri equivalent, and per-occurrence conflicts; then **Confirm & create**.
  Anchoring is unchanged (Hijri input -> Gregorian derived; Gregorian input -> Hijri derived).
- E. Dates are larger and bold: Gregorian black, Hijri dark green (#166534); high-contrast
  today/other-month/pending styles (no dark mode exists in the app).
- F. Live conflict warning below the time fields (confirmed + pending, buffer-aware) via callable
  `checkSlotConflicts`. Public callers receive only `{hasConflict, count}` (no titles/contacts/notes/times);
  admins also get the conflicting bookings. Submission is never blocked; re-evaluated on date/time/venue/mode change.
- G. **All day** = 00:00–23:59 Sydney, same day. **All night** = 18:00 -> 06:00 **next day** (`endNextDay`;
  validation is on real instants, so the overnight window is valid; DST-safe). Stored as `timeMode`
  (`custom|allDay|allNight`). Available on the booking form, series form and admin edit.
- H. Admin-only Excel: **Export Excel** (respects the From/To filter; cells starting `= + - @` are
  prefixed with `'`), **Import template**, **Import Excel…** (SheetJS 0.20.3, parsed in the admin's browser,
  max 2 MB / 500 rows, server re-validates in callable `importBookings`). Dry-run preview with row errors,
  then confirm. Departments/venues match by name (unknown = row error). Id present and found = update;
  otherwise create; same venue+time+title = skipped as duplicate (idempotent re-import). Defaults:
  confirmed + public. Times are Sydney civil time; end earlier than start = overnight. Conflicts are
  flagged, not blocked. Audit entries per row plus a summary.

## Conflict root-cause fix + date typography (committed locally, NOT deployed)
- Root cause: the Boys Cricket Tournament is booked at **"Entire MWA Precinct"**, not Main Hall, and conflict logic only compared bookings at the same venue. Added a whole-site rule: a venue with `coversAllVenues: true` (or, when unset, a name containing "entire"/"whole") conflicts with every venue, each booking using its own venue's buffer hours. Same-venue/same-time checks already worked live.
- Stored `hasConflict` flags were only refreshed at submit/edit time. Admin Bookings list/Calendar now compute conflicts live from current data (`src/utils/conflictUtils.js`); BookingModal checks live for any pending/confirmed booking an admin opens and shows "Couldn't check conflicts" instead of swallowing errors; conflict list includes venue name.
- Server: venue create/edit now triggers `onVenueChanged` to recompute all stored flags; `recomputeVenueConflicts` covers all venues. Venue admin edit has a "Whole site" checkbox (`coversAllVenues`).
- Typography: date numbers doubled (Gregorian black, Hijri green), normal weight; only today/selected are bold + underlined; yellow boxed highlight removed; cells resized responsively.
- Needs deploy (functions + hosting) to take effect.

## Mobile layout overhaul (matches original prototype)
- Mobile (<=640px) now follows the prototype: compact header (title + status row, tabs), single-row 3-tile stats, toolbar rows `‹ Month ›  Today` / `Gregorian|Hijri  venue  + New`, single horizontally scrollable chips row, 7-column grid with ~98px cells, small event pills. Desktop layout is unchanged (toolbar wrappers use `display: contents`).
- Cell dates: 15px (Gregorian black, Hijri green; 14/11px under 380px), month-start label shortened to 3 letters ("Rab", "Jum") so rows don't grow; tablet 24/18px; desktop remains doubled. Only today/selected are bold.
- Safe-area bottom padding, bottom-sheet booking dialogs with sticky X close, inputs 16px (no iOS zoom), Bookings table scrolls horizontally with compact cells. Verified with headless Edge at 360/390/768/1280 px: no horizontal page overflow.

## Secondary date line in calendar cells
- Secondary calendar date now sits on its own line below the primary date in every cell, with an abbreviated month (Hijri: Muh, Saf, Rab I, Rab II, Jum I, Jum II, Raj, Sha, Ram, Shaw, DhQ, DhH; Gregorian: Jan..Dec). Gregorian black, Hijri green; only today/selected bold. Verified at 360/390/768/1280 with no horizontal overflow.

## Hijri year default, dd/mm/yyyy Excel import/export, dropdown template
- Hijri entry (booking form incl. series, admin Hijri adjustment form) defaults to today's Hijri date (Australia/Sydney civil date, active adjustment); switching to Hijri basis pre-fills empty day/month/year. User can still change them.
- Excel import/export: dates are DD/MM/YYYY (day first) for both calendars. New **Date Basis** column (Gregorian default / Hijri). Hijri rows are Hijri day/month/year (AH), validated against Hijri month lengths (current adjustment) and stored Hijri-anchored (`dateBasis: hijri` + `hijriDate`). Parser accepts DD/MM/YYYY text, Excel serials (Gregorian only) and legacy YYYY-MM-DD. Export writes the row's source date in its basis plus informational Gregorian Date / Hijri Date columns, so export -> import round-trips.
- Import template generated with ExcelJS 4.4.0 (write-only; adds a moderate `uuid` advisory that is not reachable: no buffer argument is passed): dropdowns for Date Basis, Department, Venue (from current active names, 'Lists' sheet), Status, Visibility over rows 2-501, plus an Instructions sheet. Uploads are still parsed by SheetJS and re-validated server-side.

## Public booking six-hour lead-time protection
- Public booking form warns and moves a past/too-soon Gregorian or Hijri-resolved date/time to the earliest eligible Sydney start, rounded up to a 15-minute instant boundary; custom duration is preserved when possible. All-day/night bookings move to the next complete eligible day/night. The check reruns after date, time, basis or time-mode changes and on initial form values.
- The server independently rejects non-admin submissions whose resolved start instant is less than six hours away. Admins (including past edits, series and imports) remain exempt so historical records are preserved.
- The shared default is `minimumPublicLeadHours: 6` in `functions/calendarPolicy.json`, consumed by the client and server.


## Lovable UI redesign applied (design system)

The Lovable.dev redesign ("MWA Central" green/frosted look) is applied to the live app.
Presentation only: Firebase, Firestore, functions, Hijri anchoring, privacy masking,
conflict checks, the 6h rule, Excel and all admin features are unchanged.

- Approach: the Lovable design is almost entirely custom CSS (tokens + glass panels +
  a few classes), so its tokens and styles were ported verbatim as plain CSS in
  `src/theme.css` (oklch palette, Sora/Manrope fonts, 1rem radius, `glass-panel`,
  button variants nav/segment/soft/outline, calendar cells, agenda). Tailwind/shadcn/Radix
  were deliberately not added (no preflight clash with existing screens, no bundle growth);
  only `lucide-react` was added for icons.
- Shell: brand mark, nav pills, New booking (opens the real booking form), Admin sign in /
  signed-in email + Sign out, Public visitor chip, footer. Page title/meta updated.
- Calendar: Month / Week / Day views over real bookings, Gregorian/Hijri segmented toggle,
  venue select, department chips, Today, today/selected/outside cell styles, secondary date
  below with abbreviated month, event pills, bottom status line with real counts.
- Agenda sidebar: selected-day bookings, pending requests (admin: detail + conflict count;
  public: count of unconfirmed), venue availability from real venues, Today badge.
- Bookings table, admin tabs, sign-in and the booking dialog are restyled with the same
  tokens via legacy class overrides at the end of `src/theme.css`.
- Differences from the mock: Hijri text uses the theme green; Lovable date sizes are used on
  the calendar (not the earlier doubled sizes); filters/chips/stats that the mock lacks were kept.
## Modal fix
- Dialogs now render via a portal on document.body (the glass page panel's backdrop-filter was the containing block for the fixed overlay, making dialogs tiny/shaky).
- Viewport-fit sizing (100dvh - margins), single scroll area, sticky close, stable scrollbar gutter, no animations/blur on overlay; bottom sheet on mobile.

## Monthly PDF calendar export
- New **PDF** button on the calendar toolbar: choose a Gregorian or Hijri month, filter by department (event type) and venue, and download an A4 poster in the MWA monthly-calendar format (Islamic date | MWA event date | event, multi-page when needed).
- Public visitors get confirmed public events only; admins can additionally include pending requests or non-public events.
- Public visitors can only pick the month/basis; the calendar is always MWA Programs events at all venues (no department/venue pickers). Admins keep every option.
- **MWA Programs is never private**: confirmed MWA Programs events are always projected publicly (`functions/publicProjection.js`), regardless of the stored visibility flag. Requires a functions deploy.
- Artwork: `scripts/build-pdf-template.py` erases the month-specific text from the supplied design (`scripts/pdf-template-source.jpg`) to produce `src/assets/pdf-template-bg.jpg`; MWA logo in `src/assets/mwa-logo.png`. Text is drawn at runtime (`src/services/pdfCalendar.js`, data in `pdfModel.js`). jsPDF is lazy-loaded.
- Footer contact/dua lines are part of the artwork; edit the source image and re-run the script to change them.
- Fonts: Playfair Display and Amiri (Google Fonts) with serif fallbacks offline.
