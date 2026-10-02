# Community Hub Calendar — MVP

A shared, source-of-truth booking calendar for venues and departments, built with
**React + Vite** (frontend) and **Firebase** (Auth, Firestore, Cloud Functions, Hosting).

Public visitors can browse confirmed public events and submit booking requests without
signing in. Admins sign in with email/password to review requests, confirm/reject/cancel
bookings, manage venues/departments, adjust the Hijri moon-sighting correction, and see
an audit log.

This repository was scaffolded from `Community Hub Calendar – Prototype & Brief.html`
and `Prototype and Brief/Community-Calendar-Project-Brief.docx` in this folder, and
reuses the Hijri calendar conversion logic from the `community-events-app` repository
(see `src/services/hijriService.js`).

## Status

This is an MVP implementation, not deployed. See **docs/SETUP.md** before running it.

Implemented:
- Month calendar with department/venue filters, Gregorian + Hijri dual dates, admin
  moon-sighting adjustment.
- Public booking request form → always submitted as **Pending**; a venue/time overlap
  never blocks submission, it's flagged (`hasConflict`) for the admin to decide.
- Admin review queue: confirm / reject / cancel, with a visibility choice (public/private)
  made at confirm time.
- Public/private visibility: public visitors only ever see `status=confirmed` **and**
  `visibility=public` events, served through a Cloud Function / REST endpoint — never
  direct Firestore reads — so private hire details can't leak.
- Audit log of every submission, decision and edit.
- iCal (.ics) export (client-side, and a live public feed at `/ical`) and CSV export.
- Versioned REST API under `/v1` (see **docs/API.md**).
- Email integration seam (**docs/EMAIL_SETUP.md**) — safe no-op until a provider's SMTP
  credentials are set as Cloud Functions secrets; nothing claims to send email until it
  actually can.

Deferred / out of scope for this MVP (per the brief): payments/ticketing, recurring-series
exceptions, resource inventory, and a separate "department user" login role (the prototype
had one; the confirmed MVP scope is public-submit + admin-approve only — see
**docs/DATA_MODEL.md** for the reasoning).

## Project layout

```
src/                 React app (Vite)
  firebase/           Firebase SDK init + env-based config
  services/           Firestore/Functions client wrappers (events, venues,
                       departments, Hijri, audit, CSV/iCal export)
  contexts/           Auth context (admin session)
  pages/              Calendar, Bookings list, Admin dashboard
  components/         Header, booking modal
functions/           Cloud Functions (Admin SDK): conflict checks, approvals,
                       public API, iCal feed, email seam
firestore.rules      Security rules (admin-only event writes/reads; public
                       reads only through Cloud Functions)
firestore.indexes.json
firebase.json        Hosting + Functions + Firestore wiring
docs/                Setup, data model, API, email configuration
```

## Local development

```powershell
npm install
copy .env.example .env   # fill in your Firebase web app config
npm run dev
```

The app will show a clear "Firebase is not configured" message instead of crashing if
`.env` is missing — see docs/SETUP.md for the full checklist (project ID, enabling Auth/
Firestore, deploying rules and functions, creating the first admin user).

No deployment has been performed as part of this change.
