# Setup checklist

Nothing here was deployed or run against a live Firebase project — these are the steps
to connect the code to your existing Firebase project.

## 1. Connect the Firebase project

1. In the [Firebase console](https://console.firebase.google.com/), open your existing
   project.
2. **Project settings → General → Your apps** → add a **Web app** (if you don't have one
   yet) and copy the config values.
3. Copy `.env.example` to `.env` and paste in `VITE_FIREBASE_*` values.
4. Edit `.firebaserc` and replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your real
   project ID.

## 2. Enable the Firebase products this app uses

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

## 4. Create the first admin account

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

## 7. Deploy (when you're ready — not done as part of this change)

```powershell
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
npm run build
firebase deploy --only hosting
```

## 8. Email notifications (optional, deferred)

Booking submission/decision emails are wired up but **inactive** until SMTP credentials
are configured as Cloud Functions secrets. See **docs/EMAIL_SETUP.md**.
