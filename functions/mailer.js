// Email integration seam.
//
// No email provider credentials are configured in this MVP. This module
// defines the Cloud Functions *secrets* a future deploy can set (via
// `firebase functions:secrets:set`) and a `sendMail` helper that:
//   - sends nothing and logs a warning when secrets are unset (never throws,
//     never blocks a booking submission/decision), and
//   - sends via SMTP (nodemailer) once SMTP_HOST/PORT/USER/PASS are set.
//
// See docs/EMAIL_SETUP.md for the configuration steps once a provider is
// chosen. Nothing here claims emails are being sent unless they actually are.
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const nodemailer = require('nodemailer');

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const emailSecrets = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM];

let cachedTransporter;
function buildTransporter() {
  const host = SMTP_HOST.value();
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  if (!host || !user || !pass) return null;
  if (cachedTransporter) return cachedTransporter;
  const port = Number(SMTP_PORT.value() || 587);
  cachedTransporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return cachedTransporter;
}

/** Best-effort send. Resolves to {sent:boolean, reason?} — never throws. */
async function sendMail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  const transporter = buildTransporter();
  if (!transporter) {
    logger.warn('[email] Not configured — skipping send.', { to, subject });
    return { sent: false, reason: 'not-configured' };
  }
  try {
    const from = EMAIL_FROM.value() || SMTP_USER.value();
    await transporter.sendMail({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Send failed', { to, subject, error: String(err) });
    return { sent: false, reason: 'send-error' };
  }
}

module.exports = { sendMail, emailSecrets };
