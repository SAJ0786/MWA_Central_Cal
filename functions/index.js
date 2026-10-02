const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const express = require('express');
const cors = require('cors');

const { adjustedGregorianToIslamic, HIJRI_MONTHS } = require('./hijriService');
const { sendMail, emailSecrets } = require('./mailer');

initializeApp();
const db = getFirestore();

const REGION = 'australia-southeast1';
setGlobalOptions({ region: REGION });

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
const ACTIVE_FOR_CONFLICTS = ['pending', 'confirmed'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function requireAdmin(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in as an admin to perform this action.');
  const snap = await db.collection('users').doc(auth.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== 'admin') throw new HttpsError('permission-denied', 'Admin role required.');
  return { uid: auth.uid, email: auth.token.email || snap.data()?.email || '' };
}

async function getActiveDoc(collectionName, id, label) {
  if (!id) throw new HttpsError('invalid-argument', `${label} is required.`);
  const snap = await db.collection(collectionName).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', `${label} not found.`);
  return { id: snap.id, ...snap.data() };
}

/** Find other pending/confirmed bookings at the same venue that overlap. Read-only (safe outside or inside a transaction). */
async function findOverlaps(venueId, startAt, endAt, excludeId, tx) {
  const q = db.collection('events')
    .where('venueId', '==', venueId)
    .where('status', 'in', ACTIVE_FOR_CONFLICTS);
  const snap = tx ? await tx.get(q) : await q.get();
  const overlaps = [];
  snap.forEach(doc => {
    if (doc.id === excludeId) return;
    const d = doc.data();
    if (rangesOverlap(startAt, endAt, d.startAt, d.endAt)) overlaps.push({ id: doc.id, title: d.title });
  });
  return overlaps;
}

async function writeAudit({ entityType, entityId, action, userId, userEmail, note, diff }) {
  await db.collection('auditLog').add({
    entityType, entityId, action,
    userId: userId || null, userEmail: userEmail || null,
    note: note || '', diff: diff || null,
    timestamp: new Date().toISOString()
  });
}

async function getHijriOverrides() {
  const snap = await db.collection('calendarSettings').doc('hijri').get();
  return snap.exists ? (snap.data().overrides || []) : [];
}

function hijriInfoFor(dateKey, overrides) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const h = adjustedGregorianToIslamic(y, m, d, overrides);
  if (!h.year) return null;
  const monthName = (HIJRI_MONTHS.find(x => x.value === h.month) || {}).name || '';
  return { day: h.day, month: h.month, monthName, year: h.year };
}

function dateKeyOf(iso) {
  // Organisation timezone for day-boundary purposes.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function validateBookingPayload(data) {
  const required = ['title', 'departmentId', 'venueId', 'startAt', 'endAt', 'contactName', 'contactEmail'];
  for (const f of required) {
    if (!data || !data[f]) throw new HttpsError('invalid-argument', `Missing required field: ${f}`);
  }
  if (!(new Date(data.startAt) < new Date(data.endAt))) {
    throw new HttpsError('invalid-argument', 'End time must be after start time.');
  }
}

function sanitizePublicEvent(d, id, overrides) {
  const dateKey = dateKeyOf(d.startAt);
  return {
    id,
    title: d.title,
    departmentId: d.departmentId,
    departmentName: d.departmentName || null,
    venueId: d.venueId,
    venueName: d.venueName || null,
    startAt: d.startAt,
    endAt: d.endAt,
    status: d.status,
    visibility: d.visibility,
    dateBasis: d.dateBasis || 'gregorian',
    hijri: hijriInfoFor(dateKey, overrides)
  };
}

// ── Callable: public booking submission ─────────────────────────────────────
exports.submitBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const data = request.data || {};
  validateBookingPayload(data);

  const venue = await getActiveDoc('venues', data.venueId, 'Venue');
  const department = await getActiveDoc('departments', data.departmentId, 'Department');

  let hasConflict = false;
  let conflictWith = [];
  let eventRef;

  await db.runTransaction(async (tx) => {
    const overlaps = await findOverlaps(data.venueId, data.startAt, data.endAt, null, tx);
    hasConflict = overlaps.length > 0;
    conflictWith = overlaps.map(o => o.id);

    eventRef = db.collection('events').doc();
    tx.set(eventRef, {
      title: String(data.title).slice(0, 200),
      departmentId: data.departmentId,
      departmentName: department.name,
      venueId: data.venueId,
      venueName: venue.name,
      startAt: data.startAt,
      endAt: data.endAt,
      status: 'pending',
      // Safe default: private. Public visibility is only ever set by an
      // admin at approval time (see decideBooking), even if the requester
      // asked for public listing here.
      visibility: 'private',
      requestedVisibility: data.requestPublicListing ? 'public' : 'private',
      dateBasis: data.dateBasis === 'h' ? 'hijri' : 'gregorian',
      hijriDate: data.hijriDate || null,
      contactName: String(data.contactName).slice(0, 200),
      contactEmail: String(data.contactEmail).slice(0, 200),
      contactPhone: data.contactPhone ? String(data.contactPhone).slice(0, 50) : '',
      notes: data.notes ? String(data.notes).slice(0, 2000) : '',
      hasConflict,
      conflictWith,
      createdByUid: request.auth ? request.auth.uid : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await writeAudit({
    entityType: 'event', entityId: eventRef.id, action: 'submitted',
    userId: request.auth ? request.auth.uid : null, userEmail: data.contactEmail,
    note: hasConflict ? 'Submitted as pending with a detected venue overlap.' : 'Submitted as pending.'
  });

  // Best-effort notification seam — see functions/mailer.js. Never blocks or
  // fails the request if email isn't configured yet.
  await sendMail({
    to: data.contactEmail,
    subject: `Booking request received: ${data.title}`,
    text: `Thanks — "${data.title}" was submitted as Pending${hasConflict ? ' (it overlaps another booking at this venue; our team will review it)' : ''}. We'll email you once it's reviewed.`
  });

  return { id: eventRef.id, hasConflict, status: 'pending' };
});

// ── Callable: admin confirm/reject/cancel ───────────────────────────────────
exports.decideBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId, status, visibility, note } = request.data || {};
  if (!eventId || !STATUSES.includes(status) || status === 'pending') {
    throw new HttpsError('invalid-argument', 'eventId and a valid target status are required.');
  }

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const before = snap.data();

  let hasConflict = before.hasConflict;
  let conflictWith = before.conflictWith || [];
  if (status === 'confirmed') {
    const overlaps = await findOverlaps(before.venueId, before.startAt, before.endAt, eventId);
    hasConflict = overlaps.length > 0;
    conflictWith = overlaps.map(o => o.id);
  }

  const patch = {
    status,
    hasConflict, conflictWith,
    decidedBy: admin.uid, decidedByEmail: admin.email,
    decidedAt: FieldValue.serverTimestamp(),
    decisionNote: note || '',
    updatedAt: FieldValue.serverTimestamp()
  };
  if (status === 'confirmed') patch.visibility = visibility === 'public' ? 'public' : 'private';

  await ref.update(patch);
  await writeAudit({
    entityType: 'event', entityId: eventId, action: `status_${status}`,
    userId: admin.uid, userEmail: admin.email, note: note || '',
    diff: { from: before.status, to: status }
  });

  if (before.contactEmail) {
    await sendMail({
      to: before.contactEmail,
      subject: `Booking ${status}: ${before.title}`,
      text: `Your booking "${before.title}" was ${status}.${note ? ` Note from the team: ${note}` : ''}`
    });
  }

  return { id: eventId, status, hasConflict };
});

// ── Callable: admin edit of an existing booking's core fields ───────────────
exports.updateBooking = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId, patch } = request.data || {};
  if (!eventId || !patch) throw new HttpsError('invalid-argument', 'eventId and patch are required.');

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const before = snap.data();

  const next = { ...before, ...patch };
  const update = {
    title: patch.title ?? before.title,
    departmentId: patch.departmentId ?? before.departmentId,
    venueId: patch.venueId ?? before.venueId,
    startAt: patch.startAt ?? before.startAt,
    endAt: patch.endAt ?? before.endAt,
    contactName: patch.contactName ?? before.contactName,
    contactEmail: patch.contactEmail ?? before.contactEmail,
    contactPhone: patch.contactPhone ?? before.contactPhone,
    notes: patch.notes ?? before.notes,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (update.departmentId !== before.departmentId) {
    const dept = await getActiveDoc('departments', update.departmentId, 'Department');
    update.departmentName = dept.name;
  }
  if (update.venueId !== before.venueId) {
    const venue = await getActiveDoc('venues', update.venueId, 'Venue');
    update.venueName = venue.name;
  }

  if (update.venueId !== before.venueId || update.startAt !== before.startAt || update.endAt !== before.endAt) {
    const overlaps = await findOverlaps(update.venueId, update.startAt, update.endAt, eventId);
    update.hasConflict = overlaps.length > 0;
    update.conflictWith = overlaps.map(o => o.id);
  }

  await ref.update(update);
  await writeAudit({
    entityType: 'event', entityId: eventId, action: 'updated',
    userId: admin.uid, userEmail: admin.email
  });

  return { id: eventId, hasConflict: update.hasConflict ?? before.hasConflict };
});

// ── Callable: public read of sanitized, public+confirmed events ────────────
exports.getPublicEvents = onCall({ cors: true }, async (request) => {
  const { from, to } = request.data || {};
  let q = db.collection('events').where('visibility', '==', 'public').where('status', '==', 'confirmed');
  const snap = await q.get();
  const overrides = await getHijriOverrides();
  let events = snap.docs.map(d => sanitizePublicEvent(d.data(), d.id, overrides));
  if (from) events = events.filter(e => e.startAt >= from);
  if (to) events = events.filter(e => e.startAt <= to);
  return { events };
});

// ── Public iCal feed (confirmed + public only) ──────────────────────────────
exports.icalFeed = onRequest({ cors: true }, async (req, res) => {
  try {
    const snap = await db.collection('events').where('visibility', '==', 'public').where('status', '==', 'confirmed').get();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Community Hub Calendar//EN', 'CALSCALE:GREGORIAN'];
    snap.forEach(doc => {
      const e = doc.data();
      lines.push(
        'BEGIN:VEVENT',
        `UID:${doc.id}@community-hub-calendar`,
        `DTSTAMP:${toIcsDate(e.updatedAt || e.createdAt || e.startAt)}`,
        `DTSTART:${toIcsDate(e.startAt)}`,
        `DTEND:${toIcsDate(e.endAt)}`,
        `SUMMARY:${icsEscape(e.title)}`,
        `LOCATION:${icsEscape(e.venueName || '')}`,
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(lines.join('\r\n'));
  } catch (err) {
    logger.error('icalFeed failed', err);
    res.status(500).send('Could not build calendar feed.');
  }
});

function pad(n) { return String(n).padStart(2, '0'); }
function toIcsDate(value) {
  const d = value && value.toDate ? value.toDate() : new Date(value);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}
function icsEscape(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// ── Versioned REST API (/v1) ─────────────────────────────────────────────
// Public read access mirrors getPublicEvents (sanitized, public+confirmed
// only). Writes and status changes require a Firebase ID token for an admin
// account (Authorization: Bearer <token>). This is an MVP surface — see
// docs/API.md for the documented contract and known limitations.
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

async function authenticateAdmin(req) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    const snap = await db.collection('users').doc(decoded.uid).get();
    if (snap.exists && snap.data().role === 'admin') return { uid: decoded.uid, email: decoded.email };
    return null;
  } catch {
    return null;
  }
}

app.get('/v1/events', async (req, res) => {
  const { from, to, venue, department, status } = req.query;
  const admin = await authenticateAdmin(req);
  let query = db.collection('events');
  if (!admin) {
    // Guests may only ever see public+confirmed events, regardless of filters.
    query = query.where('visibility', '==', 'public').where('status', '==', 'confirmed');
  } else if (status) {
    query = query.where('status', '==', status);
  }
  if (venue) query = query.where('venueId', '==', venue);
  if (department) query = query.where('departmentId', '==', department);

  const snap = await query.get();
  const overrides = await getHijriOverrides();
  let events = snap.docs.map(d => admin
    ? { id: d.id, ...d.data(), hijri: hijriInfoFor(dateKeyOf(d.data().startAt), overrides) }
    : sanitizePublicEvent(d.data(), d.id, overrides));
  if (from) events = events.filter(e => e.startAt >= from);
  if (to) events = events.filter(e => e.startAt <= to);
  res.json({ events });
});

app.post('/v1/events', async (req, res) => {
  try {
    validateBookingPayload(req.body);
    const venue = await getActiveDoc('venues', req.body.venueId, 'Venue');
    const department = await getActiveDoc('departments', req.body.departmentId, 'Department');
    const overlaps = await findOverlaps(req.body.venueId, req.body.startAt, req.body.endAt, null);
    const ref = db.collection('events').doc();
    await ref.set({
      title: String(req.body.title).slice(0, 200),
      departmentId: req.body.departmentId, departmentName: department.name,
      venueId: req.body.venueId, venueName: venue.name,
      startAt: req.body.startAt, endAt: req.body.endAt,
      status: 'pending', visibility: 'private',
      requestedVisibility: req.body.requestPublicListing ? 'public' : 'private',
      dateBasis: req.body.dateBasis === 'h' ? 'hijri' : 'gregorian',
      hijriDate: req.body.hijriDate || null,
      contactName: String(req.body.contactName).slice(0, 200),
      contactEmail: String(req.body.contactEmail).slice(0, 200),
      contactPhone: req.body.contactPhone || '',
      notes: req.body.notes || '',
      hasConflict: overlaps.length > 0, conflictWith: overlaps.map(o => o.id),
      createdByUid: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    await writeAudit({ entityType: 'event', entityId: ref.id, action: 'submitted', note: 'via REST API' });
    res.status(201).json({ id: ref.id, hasConflict: overlaps.length > 0, status: 'pending' });
  } catch (err) {
    if (err instanceof HttpsError) return res.status(mapHttpsErrorCode(err.code)).json({ error: err.message, conflictWith: [] });
    logger.error('POST /v1/events failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/v1/events/:id/status', async (req, res) => {
  const admin = await authenticateAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Admin bearer token required.' });
  const { status, visibility, note } = req.body || {};
  if (!STATUSES.includes(status) || status === 'pending') return res.status(400).json({ error: 'Invalid status.' });

  const ref = db.collection('events').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Not found' });
  const before = snap.data();

  let hasConflict = before.hasConflict, conflictWith = before.conflictWith || [];
  if (status === 'confirmed') {
    const overlaps = await findOverlaps(before.venueId, before.startAt, before.endAt, req.params.id);
    hasConflict = overlaps.length > 0; conflictWith = overlaps.map(o => o.id);
  }
  const patch = {
    status, hasConflict, conflictWith,
    decidedBy: admin.uid, decidedByEmail: admin.email, decidedAt: FieldValue.serverTimestamp(),
    decisionNote: note || '', updatedAt: FieldValue.serverTimestamp()
  };
  if (status === 'confirmed') patch.visibility = visibility === 'public' ? 'public' : 'private';
  await ref.update(patch);
  await writeAudit({ entityType: 'event', entityId: req.params.id, action: `status_${status}`, userId: admin.uid, userEmail: admin.email, note });
  res.json({ id: req.params.id, status, hasConflict });
});

app.get('/v1/availability', async (req, res) => {
  const { venue, date } = req.query;
  if (!venue || !date) return res.status(400).json({ error: 'venue and date (YYYY-MM-DD) are required.' });
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  const snap = await db.collection('events')
    .where('venueId', '==', venue)
    .where('status', 'in', ACTIVE_FOR_CONFLICTS)
    .get();
  const busy = snap.docs
    .map(d => d.data())
    .filter(e => rangesOverlap(e.startAt, e.endAt, dayStart, dayEnd))
    .map(e => ({ start: e.startAt, end: e.endAt, status: e.status }));
  res.json({ venue, date, busy });
});

function mapHttpsErrorCode(code) {
  return { 'invalid-argument': 400, 'not-found': 404, 'permission-denied': 403, unauthenticated: 401 }[code] || 500;
}

exports.api = onRequest({ cors: true }, app);
