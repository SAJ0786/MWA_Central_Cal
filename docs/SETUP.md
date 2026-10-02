# Setup checklist

## Current deployment status (updated after the initial deploy)

This project **is now connected and deployed** to Firebase project
`project-7a4fb531-414f-4ade-88e` ("MWA Central Cal"):

- Firestore database created in `australia-southeast1` (Sydney); `firestore.rules` and
  `firestore.indexes.json` are deployed.
- Authentication → Email/Password sign-in is enabled.
- All 6 Cloud Functions (`submitBooking`, `decideBooking`, `updateBooking`,
  `getPublicEvents`, `icalFeed`, `api`) are deployed to `australia-southeast1` on the
  Node.js 22 runtime, with public invoker access granted (authorization is enforced
  inside the functions, not at the Cloud Run layer).
- Hosting is deployed and live at **https://project-7a4fb531-414f-4ade-88e.web.app**,
  with `/v1/**` and `/ical` rewritten to the Cloud Functions.
- Email secrets (`SMTP_HOST`/`PORT`/`USER`/`PASS`, `EMAIL_FROM`) exist in Secret Manager
  as **empty placeholders** only, so functions deploy; email sending stays inactive
  until real SMTP credentials are set — see `docs/EMAIL_SETUP.md`.
- `.env` (local-only, gitignored) is populated with the **public** Firebase web SDK
  config for this project (API key etc. — these are not secrets; they identify the app,
  not grant access, which is enforced by `firestore.rules` and the Cloud Functions).

**Deployment note**: this project was newly created under Google's current default IAM
policy (no automatic broad role grant to the default service account), so the following
one-time IAM grants were required and already applied, for anyone deploying a similar
project from scratch:
- `roles/cloudbuild.builds.builder` and `roles/datastore.user` to the default Compute
  Engine service account (`<project-number>-compute@developer.gserviceaccount.com`) —
  without these, Cloud Functions builds fail and/or can't read/write Firestore.
- `roles/run.invoker` for `allUsers` on each deployed Cloud Run service backing a
  function — without this, even public (anonymous) requests get HTTP 403 before
  reaching the function code.

**Still pending (needs you, not a deploy step)**: create the first admin account and
seed venues/departments — see steps 4–5 below. No admin account exists yet.

## 1. Connect the Firebase project (already done for this deployment)

1. In the [Firebase console](https://console.firebase.google.com/), open your existing
   project.
2. **Project settings → General → Your apps** → add a **Web app** (if you don't have one
   yet) and copy the config values.
3. Copy `.env.example` to `.env` and paste in `VITE_FIREBASE_*` values.
4. Edit `.firebaserc` and replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your real
   project ID.

## 2. Enable the Firebase products this app uses (already done for this deployment)

In the console, enable:
- **Authentication** → Sign-in method → **Email/Password** (this is the only sign-in
  method; admins only, no public self-signup).
- **Firestore Database** (production mode; the rules in `firestore.rules` lock it down).
- **Functions** (requires the project to be on the Blaze plan — Cloud Functions always
  does, even for the free tier of usage).
- **Hosting** (optional until you're ready to deploy).

## 3. Install dependencies

```powershell
npm install
cd functions; npm install; cd ..
```

## 4. Create the first admin account (pending — do this next)

There is no public admin sign-up. Create the first admin manually:

1. **Authentication → Users → Add user** — create an email/password account.
2. **Firestore → Start collection `users`** → document ID = that user's UID (copy it
   from the Authentication tab) → add field `role` = `admin` (string), plus `email`.

Any later admin accounts can be created the same way (or an existing admin can add a
`users/{uid}` doc with `role: admin` once your own internal process lets authenticated
non-admin accounts register — not built in this MVP).

## 5. Seed venues and departments

The public booking form needs at least one venue and department to exist. Either:
- **Firestore console**: create a few documents in `venues` (fields: `name`, `capacity`,
  `hireable`, `bufferMinutes`, `active`) and `departments` (fields: `name`, `colorHex`,
  `approvalRequired`, `active`), or
- Sign in as the admin you created and use **Admin → Venues / Departments** in the app.

## 6. Run locally

```powershell
npm run dev
```

To exercise the Cloud Functions locally instead of a deployed project, use the Firebase
emulator suite (`firebase emulators:start`) — requires the Firebase CLI
(`npm install -g firebase-tools`) and `firebase login`.

## 7. Deploy (already done for this project — commands used for reference)

```powershell
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
npm run build
firebase deploy --only hosting
```

To redeploy after future code changes, rerun the relevant command(s) above.

## 8. Email notifications (optional, deferred)

Booking submission/decision emails are wired up but **inactive** until SMTP credentials
are configured as Cloud Functions secrets. See **docs/EMAIL_SETUP.md**.
