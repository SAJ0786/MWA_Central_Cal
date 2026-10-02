# Email notifications — integration seam

**Status: not active.** No email provider credentials are configured anywhere in this
repository, and none are hard-coded in source. `functions/mailer.js` defines the seam;
until the secrets below are set, `sendMail()` logs a warning and returns
`{ sent: false, reason: 'not-configured' }` — it never throws, so booking submission and
admin decisions always succeed even without email configured.

## What's already wired up

- `submitBooking` emails the requester's `contactEmail` on submission (confirming Pending
  status, noting if an overlap was flagged).
- `decideBooking` emails the requester when an admin confirms/rejects/cancels.

Both calls are best-effort and non-blocking.

## Turning it on

Once you've chosen a provider (e.g. your organisation's SMTP relay, Gmail with an app
password, SendGrid's SMTP relay, Postmark, etc.), set these as Cloud Functions secrets —
**never put them in `.env`, source files, or commit them**:

```powershell
firebase functions:secrets:set SMTP_HOST
firebase functions:secrets:set SMTP_PORT   # e.g. 587, or 465 for implicit TLS
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase functions:secrets:set EMAIL_FROM  # e.g. "Community Hub Calendar <noreply@yourdomain>"
```

Then redeploy functions:

```powershell
firebase deploy --only functions
```

No code changes are required — `submitBooking` and `decideBooking` already declare these
secrets and will start sending as soon as they resolve to real values.

## Verifying

After setting secrets and deploying, submit a test booking and check the Cloud Functions
logs (`firebase functions:log`) for either a successful send or a `[email] Send failed`
entry with the underlying SMTP error.
