const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const express = require('express');
const cors = require('cors');

const { adjustedGregorianToIslamic, HIJRI_MONTHS } = require('./hijriService');
const { sendMail, emailSecrets } = require('./mailer');
const { resolveBufferHours, rangesOverlap, rangesOverlapBuffered, rangesConflict, computeConflictMap } = require('./conflictUtils');
const { validateImportRows, MAX_IMPORT_ROWS } = require('./bookingImport');
const { buildConflictResponse } = require('./conflictResponse');
const { resolveBookingDates } = require('./hijriRecompute');
const { projectPublicEvent } = require('./publicProjection');
const { generateOccurrences, RecurrenceError } = require('./recurrence');
const { normalizeScope, selectSeriesTargets, retimeOccurrence } = require('./seriesScope');
const { toOrgTimeParts } = require('./dateUtils');

initializeApp();
const db = getFirestore();

const REGION = 'australia-southeast1';
setGlobalOptions({ region: REGION });

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
const ACTIVE_FOR_CONFLICTS = ['pending', 'confirmed'];

// ── Helpers ──────────────────────────────────────────────────────────────────


async function requireAdmin(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in as an admin to perform this action.');
  const snap = await db.collection('users').doc(auth.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== 'admin') throw new HttpsError('permission-denied', 'Admin role required.');
  return { uid: auth.uid, email: auth.token.email || snap.data()?.email || '' };
}

/** Non-throwing admin check — used where a submission may come from either a
 * signed-in admin (who gets an explicit visibility choice) or the public
 * (whose submissions default to a different visibility). */
async function isSubmitterAdmin(auth) {
  if (!auth) return false;
  const snap = await db.collection('users').doc(auth.uid).get();
  return snap.exists && snap.data().role === 'admin';
}

function sanitizeTimeMode(value) {
  return value === 'allDay' || value === 'allNight' ? value : 'custom';
}

function sanitizeVisibility(value) {
  return value === 'public' || value === 'private' ? value : null;
}

async function getActiveDoc(collectionName, id, label) {
  if (!id) throw new HttpsError('invalid-argument', `${label} is required.`);
  const snap = await db.collection(collectionName).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', `${label} not found.`);
  return { id: snap.id, ...snap.data() };
}

/** Find other pending/confirmed bookings at the same venue that overlap, honouring the
 * venue's post-booking buffer on each *existing* booking's end time. Read-only (safe
 * outside or inside a transaction). Pass `bufferHours` if already known (e.g. the venue
 * doc was already fetched); otherwise it's resolved from the venue doc here. */
async function findOverlaps(venueId, startAt, endAt, excludeId, tx, bufferHours) {
  let effectiveBufferHours = bufferHours;
  if (effectiveBufferHours === undefined) {
    const venueRef = db.collection('venues').doc(venueId);
    const venueSnap = tx ? await tx.get(venueRef) : await venueRef.get();
    effectiveBufferHours = resolveBufferHours(venueSnap.exists ? venueSnap.data() : null);
  }

  const q = db.collection('events')
    .where('venueId', '==', venueId)
    .where('status', 'in', ACTIVE_FOR_CONFLICTS);
  const snap = tx ? await tx.get(q) : await q.get();
  const overlaps = [];
  snap.forEach(doc => {
    if (doc.id === excludeId) return;
    const d = doc.data();
    if (rangesConflict({ startAt, endAt }, d, effectiveBufferHours)) {
      overlaps.push({ id: doc.id, title: d.title, status: d.status, startAt: d.startAt, endAt: d.endAt, departmentName: d.departmentName, contactName: d.contactName, visibility: d.visibility });
    }
  });
  return overlaps;
}

/** Buffer-aware overlap check for many candidate ranges at one venue with a single read.
 * Same interval semantics as findOverlaps (existing booking occupies [start, end + buffer]).
 * `excludeIds` are docs ignored as "existing" (e.g. the series being edited). */
async function bulkOverlaps(venueId, items, excludeIds, bufferHours) {
  const snap = await db.collection('events').where('venueId', '==', venueId).where('status', 'in', ACTIVE_FOR_CONFLICTS).get();
  const skip = new Set(excludeIds || []);
  const existing = snap.docs.filter(d => !skip.has(d.id)).map(d => ({ id: d.id, ...d.data() }));
  const result = new Map();
  const details = new Map();
  for (const item of items) {
    result.set(item.id, existing
      .filter(o => rangesConflict(item, o, bufferHours))
      .map(o => o.id));
    details.set(item.id, existing
      .filter(o => rangesConflict(item, o, bufferHours))
      .map(o => ({ id: o.id, title: o.title || '', status: o.status, startAt: o.startAt, endAt: o.endAt })));
  }
  result.details = details;
  return result;
}

/** Recompute the stored hasConflict/conflictWith flags for every active booking at the
 * given venues (symmetric, buffer-aware), writing only the documents whose flags changed.
 * Keeps stale flags from hiding a conflict when a booking is created/moved/confirmed later. */
async function recomputeVenueConflicts(venueIds) {
  let changed = 0;
  for (const venueId of [...new Set(venueIds.filter(Boolean))]) {
    const venueSnap = await db.collection('venues').doc(venueId).get();
    const buffer = resolveBufferHours(venueSnap.exists ? venueSnap.data() : null);
    const snap = await db.collection('events').where('venueId', '==', venueId).where('status', 'in', ACTIVE_FOR_CONFLICTS).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const map = computeConflictMap(docs, buffer);
    const writes = [];
    for (const d of docs) {
      const ids = (map.get(d.id) || []).slice().sort();
      const prev = (d.conflictWith || []).slice().sort();
      const has = ids.length > 0;
      if (Boolean(d.hasConflict) !== has || ids.join(',') !== prev.join(',')) {
        changed += 1;
        writes.push((batch) => batch.update(db.collection('events').doc(d.id), { hasConflict: has, conflictWith: ids }));
      }
    }
    await commitInChunks(writes);
  }
  return changed;
}

async function commitInChunks(writes, size = 400) {
  for (let i = 0; i < writes.length; i += size) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + size)) w(batch);
    await batch.commit();
  }
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

// Public projection (see publicProjection.js): confirmed+public in full; confirmed
// private and pending masked; everything else (rejected/cancelled) dropped (null).
function sanitizePublicEvent(d, id, overrides) {
  return projectPublicEvent(d, id, hijriInfoFor(dateKeyOf(d.startAt), overrides));
}

const PUBLIC_STATUSES = ['pending', 'confirmed'];
// ── Callable: public booking submission ─────────────────────────────────────
exports.submitBooking = onCall({ cors: true, secrets: emailSecrets }, async (request) => {
  const data = request.data || {};
  validateBookingPayload(data);

  const venue = await getActiveDoc('venues', data.venueId, 'Venue');
  const department = await getActiveDoc('departments', data.departmentId, 'Department');

  // Server-side source of truth for Hijri-based submissions: re-derive the
  // resolved Gregorian startAt/endAt from the submitted hijriDate + the
  // *current* moon-sighting overrides, rather than trusting whatever the
  // client happened to compute (which may be stale by the time it's
  // received). Gregorian-based submissions are passed through unchanged.
  const overrides = await getHijriOverrides();
  const resolvedDates = resolveBookingDates(data, overrides);

  // Visibility rule: public submitters default to 'public' (safe because
  // pending bookings only appear publicly as masked items regardless of visibility —
  // see publicProjection.js). A signed-in admin creating a booking on someone's
  // behalf may explicitly choose public/private; if they don't specify one,
  // it defaults to private (the safer choice for admin-entered bookings).
  const submitterIsAdmin = await isSubmitterAdmin(request.auth);
  const explicitVisibility = sanitizeVisibility(data.visibility);
  const visibility = submitterIsAdmin
    ? (explicitVisibility || 'private')
    : (explicitVisibility || 'public');

  let hasConflict = false;
  let conflictWith = [];
  let eventRef;

  const venueBufferHours = resolveBufferHours(venue);

  await db.runTransaction(async (tx) => {
    const overlaps = await findOverlaps(data.venueId, resolvedDates.startAt, resolvedDates.endAt, null, tx, venueBufferHours);
    hasConflict = overlaps.length > 0;
    conflictWith = overlaps.map(o => o.id);

    eventRef = db.collection('events').doc();
    tx.set(eventRef, {
      title: String(data.title).slice(0, 200),
      departmentId: data.departmentId,
      departmentName: department.name,
      venueId: data.venueId,
      venueName: venue.name,
      startAt: resolvedDates.startAt,
      endAt: resolvedDates.endAt,
      status: 'pending',
      // Pending bookings are always hidden from public views/feeds regardless
      // of this flag (see the status === 'confirmed' gate above) — this only
      // determines what happens once/if the booking is later confirmed.
      visibility,
      requestedVisibility: visibility,
      dateBasis: data.dateBasis === 'h' ? 'hijri' : 'gregorian',
      hijriDate: data.hijriDate || null,
      timeMode: sanitizeTimeMode(data.timeMode),
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

  await recomputeVenueConflicts([data.venueId]);
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
  // Visibility is now set at submission time and editable by an admin at any
  // point (see updateBooking); a decision only overrides it if the admin
  // explicitly picks one here, otherwise the booking's existing visibility is
  // preserved rather than being silently reset to private.
  const explicitVisibility = sanitizeVisibility(visibility);
  if (explicitVisibility) patch.visibility = explicitVisibility;

  await ref.update(patch);
  await recomputeVenueConflicts([before.venueId]);
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
  const scope = normalizeScope((request.data || {}).scope);
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
  if (patch.timeMode !== undefined) update.timeMode = sanitizeTimeMode(patch.timeMode);
  const nowIso = new Date().toISOString();

  // Admins can change a booking's public/private visibility at any point,
  // independent of its status — not only at confirm/decision time.
  const explicitVisibility = sanitizeVisibility(patch.visibility);
  if (explicitVisibility) update.visibility = explicitVisibility;

  if (update.departmentId !== before.departmentId) {
    const dept = await getActiveDoc('departments', update.departmentId, 'Department');
    update.departmentName = dept.name;
  }
  if (update.venueId !== before.venueId) {
    const venue = await getActiveDoc('venues', update.venueId, 'Venue');
    update.venueName = venue.name;
  }

  // Preserve-source-date rule: if this booking was Hijri-sourced and the admin
  // is now setting a startAt/endAt that differs from what its source hijriDate
  // currently resolves to, that's an explicit manual reschedule — detach it
  // from the Hijri anchor (switch to dateBasis 'gregorian', clear hijriDate) so
  // a later moon-sighting adjustment doesn't silently move it again. If the
  // edit didn't touch the date/time, the Hijri anchor is left untouched.
  if (before.dateBasis === 'hijri' && before.hijriDate) {
    const overrides = await getHijriOverrides();
    const resolvedBefore = resolveBookingDates(before, overrides);
    // Compare civil dates only: a time-of-day edit keeps the Hijri anchor (the resolver preserves time-of-day).
    if (dateKeyOf(update.startAt) !== dateKeyOf(resolvedBefore.startAt) || dateKeyOf(update.endAt) !== dateKeyOf(resolvedBefore.endAt)) {
      update.dateBasis = 'gregorian';
      update.hijriDate = null;
    }
  }

  if (update.venueId !== before.venueId || update.startAt !== before.startAt || update.endAt !== before.endAt) {
    const overlaps = await findOverlaps(update.venueId, update.startAt, update.endAt, eventId);
    update.hasConflict = overlaps.length > 0;
    update.conflictWith = overlaps.map(o => o.id);
  }

  // Scoped edits of a recurring series ('future' / 'all'): shared fields and the
  // time-of-day are applied to every targeted occurrence, each keeping its own date.
  // Moving the date is only allowed for a single occurrence.
  let seriesTargets = [];
  if (scope !== 'single' && before.seriesId) {
    if (dateKeyOf(update.startAt) !== dateKeyOf(before.startAt)) {
      throw new HttpsError('invalid-argument', 'Dates can only be changed for a single occurrence. Choose "This occurrence only", or delete and recreate the series.');
    }
    const seriesSnap = await db.collection('events').where('seriesId', '==', before.seriesId).get();
    const docs = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Past occurrences (already started) are history: never touched by multi-occurrence scopes.
    seriesTargets = selectSeriesTargets(docs, { id: eventId, ...before }, scope, nowIso).filter(t => t.id !== eventId);
  }

  const anchorLocked = scope !== 'single' && Boolean(before.seriesId) && before.startAt <= nowIso;
  if (anchorLocked && !seriesTargets.length) {
    throw new HttpsError('failed-precondition', 'No upcoming occurrences to change. Past occurrences are kept as records.');
  }
  if (!anchorLocked) await ref.update(update);

  let seriesUpdated = 0;
  if (seriesTargets.length) {
    const shared = {};
    for (const k of ['title', 'departmentId', 'departmentName', 'venueId', 'venueName', 'contactName', 'contactEmail', 'contactPhone', 'notes', 'visibility']) {
      if (update[k] !== undefined) shared[k] = update[k];
    }
    const newStart = toOrgTimeParts(update.startAt).timeStr;
    const newEnd = toOrgTimeParts(update.endAt).timeStr;
    const endNextDay = dateKeyOf(update.endAt) !== dateKeyOf(update.startAt);
    const timeChanged = newStart !== toOrgTimeParts(before.startAt).timeStr || newEnd !== toOrgTimeParts(before.endAt).timeStr;
    const retimed = seriesTargets.map(t => {
      const times = timeChanged ? retimeOccurrence(t, newStart, newEnd, endNextDay) : { startAt: t.startAt, endAt: t.endAt };
      return { id: t.id, ...times };
    });
    const venueSnap = await db.collection('venues').doc(update.venueId).get();
    const overlapMap = await bulkOverlaps(update.venueId, retimed, [eventId, ...retimed.map(r => r.id)], resolveBufferHours(venueSnap.exists ? venueSnap.data() : null));
    let batch = db.batch();
    let ops = 0;
    for (const r of retimed) {
      const ids = overlapMap.get(r.id) || [];
      const patchDoc = { ...shared, ...(timeChanged ? { startAt: r.startAt, endAt: r.endAt } : {}), ...(update.timeMode ? { timeMode: update.timeMode } : {}), hasConflict: ids.length > 0, conflictWith: ids, updatedAt: FieldValue.serverTimestamp() };
      batch.update(db.collection('events').doc(r.id), patchDoc);
      ops += 1; seriesUpdated += 1;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops) await batch.commit();
    await writeAudit({
      entityType: 'series', entityId: before.seriesId, action: 'series_updated',
      userId: admin.uid, userEmail: admin.email,
      note: `Scope "${scope}": applied edit to ${seriesUpdated + (anchorLocked ? 0 : 1)} upcoming occurrence(s) (anchor ${eventId}); past occurrences unchanged.`
    });
  }

  await recomputeVenueConflicts([before.venueId, update.venueId]);
  await writeAudit({
    entityType: 'event', entityId: eventId, action: 'updated',
    userId: admin.uid, userEmail: admin.email,
    diff: update.visibility && update.visibility !== before.visibility
      ? { visibility: { from: before.visibility || 'private', to: update.visibility } }
      : null
  });

  const fresh = await ref.get();
  return { id: eventId, hasConflict: fresh.exists ? Boolean(fresh.data().hasConflict) : false, seriesUpdated };
});

// ── Callable: admin-only recurring booking creation ─────────────────────────
// Expands the rule server-side (recurrence.js: Sydney civil time, DST-safe, Hijri-anchored),
// flags (never blocks) per-occurrence venue overlaps using the venue buffer, and writes
// every occurrence with a shared seriesId. Admin-created: defaults to confirmed + private.
async function expandSeries(data) {
  for (const f of ['title', 'departmentId', 'venueId', 'contactName', 'contactEmail']) {
    if (!data[f]) throw new HttpsError('invalid-argument', `Missing required field: ${f}`);
  }
  const venue = await getActiveDoc('venues', data.venueId, 'Venue');
  const department = await getActiveDoc('departments', data.departmentId, 'Department');
  const overrides = await getHijriOverrides();
  let occurrences;
  try {
    occurrences = generateOccurrences(data.recurrence, overrides);
  } catch (err) {
    if (err instanceof RecurrenceError) throw new HttpsError('invalid-argument', err.message);
    throw err;
  }
  const refs = occurrences.map(() => db.collection('events').doc());
  const overlapMap = await bulkOverlaps(
    data.venueId,
    occurrences.map((o, i) => ({ id: refs[i].id, startAt: o.startAt, endAt: o.endAt })),
    [], resolveBufferHours(venue)
  );
  return { venue, department, occurrences, refs, overlapMap };
}

// ── Callable: admin-only preview of a series (exact count, dates, per-occurrence conflicts) ──
exports.previewRecurringBooking = onCall({ cors: true }, async (request) => {
  await requireAdmin(request.auth);
  const { occurrences, refs, overlapMap } = await expandSeries(request.data || {});
  const items = occurrences.map((o, i) => {
    const conflicts = overlapMap.details.get(refs[i].id) || [];
    return {
      index: o.index, startAt: o.startAt, endAt: o.endAt,
      hijri: o.hijriDisplay || o.hijriDate || null,
      hasConflict: conflicts.length > 0, conflicts
    };
  });
  return { count: items.length, conflicts: items.filter(i => i.hasConflict).length, occurrences: items };
});

exports.createRecurringBooking = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const data = request.data || {};
  const { venue, department, occurrences, refs, overlapMap } = await expandSeries(data);

  const status = data.status === 'pending' ? 'pending' : 'confirmed';
  const visibility = sanitizeVisibility(data.visibility) || 'public';
  const rule = data.recurrence;
  const seriesId = db.collection('events').doc().id;
  const recurrence = {
    basis: rule.basis === 'hijri' ? 'hijri' : 'gregorian',
    frequency: rule.frequency, repeatEvery: Number(rule.repeatEvery),
    endMode: rule.endMode,
    endDate: rule.endMode === 'date' ? rule.endDate : null,
    count: rule.endMode === 'count' ? Number(rule.count) : null,
    startTime: rule.startTime, endTime: rule.endTime,
    endNextDay: rule.endNextDay === true,
    timeMode: sanitizeTimeMode(data.timeMode)
  };

  let conflicts = 0;
  const writes = occurrences.map((o, i) => {
    const ids = overlapMap.get(refs[i].id) || [];
    if (ids.length) conflicts += 1;
    return (batch) => batch.set(refs[i], {
      title: String(data.title).slice(0, 200),
      departmentId: data.departmentId, departmentName: department.name,
      venueId: data.venueId, venueName: venue.name,
      startAt: o.startAt, endAt: o.endAt,
      status, visibility, requestedVisibility: visibility,
      dateBasis: recurrence.basis, hijriDate: o.hijriDate, timeMode: recurrence.timeMode,
      contactName: String(data.contactName).slice(0, 200),
      contactEmail: String(data.contactEmail).slice(0, 200),
      contactPhone: data.contactPhone ? String(data.contactPhone).slice(0, 50) : '',
      notes: data.notes ? String(data.notes).slice(0, 2000) : '',
      hasConflict: ids.length > 0, conflictWith: ids,
      seriesId, seriesIndex: o.index, seriesCount: occurrences.length, recurrence,
      createdByUid: admin.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
  });
  await commitInChunks(writes);
  await recomputeVenueConflicts([data.venueId]);
  await writeAudit({
    entityType: 'series', entityId: seriesId, action: 'series_created',
    userId: admin.uid, userEmail: admin.email,
    note: `Created ${occurrences.length} recurring occurrence(s) as ${status}; ${conflicts} flagged with a venue overlap.`,
    diff: { recurrence }
  });
  return { seriesId, created: occurrences.length, conflicts, status };
});

// ── Callable: admin-only delete (single occurrence, this & future, or whole series) ──
exports.deleteBooking = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { eventId } = request.data || {};
  const scope = normalizeScope((request.data || {}).scope);
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  const snap = await db.collection('events').doc(eventId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const anchor = { id: eventId, ...snap.data() };
  const nowIso = new Date().toISOString();

  // Past bookings are permanent records: they are never hard-deleted (cancel instead).
  let targets = [anchor];
  let kept = 0;
  if (scope !== 'single' && anchor.seriesId) {
    const seriesSnap = await db.collection('events').where('seriesId', '==', anchor.seriesId).get();
    const docs = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const all = selectSeriesTargets(docs, anchor, scope);
    targets = selectSeriesTargets(docs, anchor, scope, nowIso);
    kept = all.length - targets.length;
    if (!targets.length) throw new HttpsError('failed-precondition', 'All matching occurrences are in the past and are kept as records.');
  } else if (anchor.startAt <= nowIso) {
    throw new HttpsError('failed-precondition', 'Past bookings are kept as records and cannot be deleted. Cancel it instead.');
  }

  const writes = [];
  for (const t of targets) {
    writes.push((batch) => batch.delete(db.collection('events').doc(t.id)));
    writes.push((batch) => batch.set(db.collection('auditLog').doc(), {
      entityType: 'event', entityId: t.id, action: 'deleted',
      userId: admin.uid, userEmail: admin.email,
      note: `Deleted "${String(t.title || '').slice(0, 80)}" (${t.startAt}, was ${t.status})${anchor.seriesId ? `, series ${anchor.seriesId}, scope ${scope}` : ''}.`,
      diff: null, timestamp: new Date().toISOString()
    }));
  }
  await commitInChunks(writes, 400);
  await recomputeVenueConflicts([anchor.venueId]);
  return { deleted: targets.length, kept, scope };
});

// ── Callable: live slot conflict check (public-safe) ───────────────────────
// Public callers get only { hasConflict, count }; admins also get the conflicting bookings.
exports.checkSlotConflicts = onCall({ cors: true }, async (request) => {
  const { venueId, startAt, endAt, excludeId } = request.data || {};
  if (!venueId || typeof venueId !== 'string' || !startAt || !endAt) {
    throw new HttpsError('invalid-argument', 'venueId, startAt and endAt are required.');
  }
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) throw new HttpsError('invalid-argument', 'Invalid time range.');
  const venueSnap = await db.collection('venues').doc(venueId).get();
  if (!venueSnap.exists) throw new HttpsError('not-found', 'Venue not found.');
  const isAdmin = await isSubmitterAdmin(request.auth);
  const overlaps = await findOverlaps(venueId, new Date(s).toISOString(), new Date(e).toISOString(), isAdmin ? excludeId : null, undefined, resolveBufferHours(venueSnap.data()));
  return buildConflictResponse(overlaps, isAdmin);
});

// ── Callable: admin recompute of every stored conflict flag ────────────────
exports.recomputeAllConflicts = onCall({ cors: true }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const venues = await db.collection('venues').get();
  const changed = await recomputeVenueConflicts(venues.docs.map(d => d.id));
  await writeAudit({ entityType: 'event', entityId: 'all', action: 'conflicts_recomputed', userId: admin.uid, userEmail: admin.email, note: `Recomputed conflicts for ${venues.size} venue(s); ${changed} booking(s) changed.` });
  return { venues: venues.size, changed };
});

// ── Callable: admin Excel import (dryRun returns the validation report only) ──
exports.importBookings = onCall({ cors: true, timeoutSeconds: 120 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const { rows, dryRun } = request.data || {};
  if (!Array.isArray(rows)) throw new HttpsError('invalid-argument', 'rows must be an array.');
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpsError('invalid-argument', `Too many rows (max ${MAX_IMPORT_ROWS}).`);

  const [deptSnap, venueSnap, eventSnap] = await Promise.all([
    db.collection('departments').get(), db.collection('venues').get(), db.collection('events').get()
  ]);
  const departments = deptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const venues = venueSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const existingById = {};
  const existingKeys = new Set();
  eventSnap.forEach(d => {
    const v = d.data();
    existingById[d.id] = v;
    existingKeys.add(`${v.venueId}|${v.startAt}|${v.endAt}|${String(v.title || '').trim().toLowerCase()}`);
  });

  const report = validateImportRows(rows, { departments, venues, existingById, existingKeys });
  const summary = {
    errors: report.errors, counts: report.counts,
    rows: report.rows.map(r => ({ row: r.row, action: r.action, id: r.id || null, title: r.data.title, startAt: r.data.startAt, endAt: r.data.endAt, warnings: r.warnings }))
  };
  if (dryRun) return { dryRun: true, ...summary };
  if (report.errors.length) throw new HttpsError('failed-precondition', 'Fix the row errors before importing.');

  const writes = [];
  const venueIds = [];
  let created = 0; let updated = 0;
  for (const r of report.rows) {
    if (r.action === 'skip') continue;
    const ref = r.action === 'update' ? db.collection('events').doc(r.id) : db.collection('events').doc();
    const base = { ...r.data, venueId: r.data.venueId, updatedAt: FieldValue.serverTimestamp() };
    venueIds.push(r.data.venueId);
    if (r.action === 'update') {
      updated += 1;
      if (existingById[r.id] && existingById[r.id].venueId) venueIds.push(existingById[r.id].venueId);
      writes.push((batch) => batch.set(ref, base, { merge: true }));
    } else {
      created += 1;
      writes.push((batch) => batch.set(ref, { ...base, hasConflict: false, conflictWith: [], dateBasis: 'gregorian', hijriDate: null, createdByUid: admin.uid, createdAt: FieldValue.serverTimestamp() }));
    }
    writes.push((batch) => batch.set(db.collection('auditLog').doc(), {
      entityType: 'event', entityId: ref.id, action: r.action === 'update' ? 'import_updated' : 'imported',
      userId: admin.uid, userEmail: admin.email,
      note: `Excel import row ${r.row}: ${String(r.data.title).slice(0, 80)}`, diff: null, timestamp: new Date().toISOString()
    }));
  }
  await commitInChunks(writes, 400);
  await recomputeVenueConflicts(venueIds);
  await writeAudit({ entityType: 'event', entityId: 'import', action: 'import_summary', userId: admin.uid, userEmail: admin.email, note: `Excel import: ${created} created, ${updated} updated, ${report.counts.skip || 0} skipped.` });
  return { dryRun: false, created, updated, skipped: report.counts.skip || 0, ...summary };
});

// ── Callable: public read of sanitized events (confirmed in full if public; private & pending masked) ──
exports.getPublicEvents = onCall({ cors: true }, async (request) => {
  const { from, to } = request.data || {};
  const snap = await db.collection('events').where('status', 'in', PUBLIC_STATUSES).get();
  const overrides = await getHijriOverrides();
  let events = snap.docs.map(d => sanitizePublicEvent(d.data(), d.id, overrides)).filter(Boolean);
  if (from) events = events.filter(e => e.startAt >= from);
  if (to) events = events.filter(e => e.startAt <= to);
  return { events };
});

// ── Public iCal feed (confirmed + public only) ──────────────────────────────
exports.icalFeed = onRequest({ cors: true }, async (req, res) => {
  try {
    const snap = await db.collection('events').where('status', 'in', PUBLIC_STATUSES).get();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MWA Central Calendar//EN', 'CALSCALE:GREGORIAN'];
    snap.forEach(doc => {
      // Masked projection: private/pending items show only time + venue with a masked title.
      const e = projectPublicEvent(doc.data(), doc.id, null);
      if (!e) return;
      const sourceDoc = doc.data();
      lines.push(
        'BEGIN:VEVENT',
        // UID domain intentionally kept stable across the app rename — see
        // src/services/exportService.js for why (avoids breaking subscribers'
        // existing event dedup/update matching).
        `UID:${doc.id}@community-hub-calendar`,
        `DTSTAMP:${toIcsDate(sourceDoc.updatedAt || sourceDoc.createdAt || e.startAt)}`,
        `DTSTART:${toIcsDate(e.startAt)}`,
        `DTEND:${toIcsDate(e.endAt)}`,
        `SUMMARY:${icsEscape(e.title)}`,
        `LOCATION:${icsEscape(e.venueName || '')}`,
        `STATUS:${e.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
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
    // Guests only ever receive the sanitized projection (confirmed in full if public,
    // masked if private; pending masked; rejected/cancelled dropped), regardless of filters.
    query = query.where('status', 'in', PUBLIC_STATUSES);
  } else if (status) {
    query = query.where('status', '==', status);
  }
  if (venue) query = query.where('venueId', '==', venue);
  if (department) query = query.where('departmentId', '==', department);

  const snap = await query.get();
  const overrides = await getHijriOverrides();
  let events = snap.docs.map(d => admin
    ? { id: d.id, ...d.data(), hijri: hijriInfoFor(dateKeyOf(d.data().startAt), overrides) }
    : sanitizePublicEvent(d.data(), d.id, overrides)).filter(Boolean);
  if (from) events = events.filter(e => e.startAt >= from);
  if (to) events = events.filter(e => e.startAt <= to);
  res.json({ events });
});

app.post('/v1/events', async (req, res) => {
  try {
    validateBookingPayload(req.body);
    const venue = await getActiveDoc('venues', req.body.venueId, 'Venue');
    const department = await getActiveDoc('departments', req.body.departmentId, 'Department');
    const overrides = await getHijriOverrides();
    const resolvedDates = resolveBookingDates(req.body, overrides);
    const overlaps = await findOverlaps(req.body.venueId, resolvedDates.startAt, resolvedDates.endAt, null, undefined, resolveBufferHours(venue));
    // Same visibility rule as the submitBooking callable: public submissions
    // default to 'public' (safe — pending bookings are masked publicly regardless),
    // an authenticated admin caller may explicitly choose, defaulting to
    // 'private' for admin-entered bookings if unspecified.
    const admin = await authenticateAdmin(req);
    const explicitVisibility = sanitizeVisibility(req.body.visibility);
    const visibility = admin ? (explicitVisibility || 'private') : (explicitVisibility || 'public');
    const ref = db.collection('events').doc();
    await ref.set({
      title: String(req.body.title).slice(0, 200),
      departmentId: req.body.departmentId, departmentName: department.name,
      venueId: req.body.venueId, venueName: venue.name,
      startAt: resolvedDates.startAt, endAt: resolvedDates.endAt,
      status: 'pending', visibility,
      requestedVisibility: visibility,
      dateBasis: req.body.dateBasis === 'h' ? 'hijri' : 'gregorian',
      hijriDate: req.body.hijriDate || null,
      contactName: String(req.body.contactName).slice(0, 200),
      contactEmail: String(req.body.contactEmail).slice(0, 200),
      contactPhone: req.body.contactPhone || '',
      notes: req.body.notes || '',
      hasConflict: overlaps.length > 0, conflictWith: overlaps.map(o => o.id),
      createdByUid: admin ? admin.uid : null,
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
  const explicitVisibility = sanitizeVisibility(visibility);
  if (explicitVisibility) patch.visibility = explicitVisibility;
  await ref.update(patch);
  await writeAudit({ entityType: 'event', entityId: req.params.id, action: `status_${status}`, userId: admin.uid, userEmail: admin.email, note });
  res.json({ id: req.params.id, status, hasConflict });
});

// Note: this reports raw (unbuffered) booked windows for day-level display, not the
// buffered conflict rule used by hasConflict/conflictWith above — see docs/API.md.
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

// ── Trigger: re-resolve Hijri-sourced bookings after an admin moon-sighting
// adjustment ──────────────────────────────────────────────────────────────
// Gregorian-based bookings never move — their stored startAt/endAt is always
// the source of truth and only their *displayed* Hijri equivalent changes.
// Hijri-based bookings are fixed to their stored hijriDate {day, month, year};
// when the admin changes calendarSettings/hijri (a new/updated/removed
// moon-sighting override), every Hijri-sourced booking's resolved Gregorian
// startAt/endAt is recomputed here so its calendar placement, conflict
// detection and exports/API all reflect the new adjustment, without ever
// touching the booking's fixed Hijri day.
exports.onHijriSettingsChanged = onDocumentWritten('calendarSettings/hijri', async (event) => {
  const beforeOverrides = event.data?.before?.exists ? (event.data.before.data().overrides || []) : [];
  const afterOverrides = event.data?.after?.exists ? (event.data.after.data().overrides || []) : [];
  if (JSON.stringify(beforeOverrides) === JSON.stringify(afterOverrides)) return; // no-op write, skip

  const snap = await db.collection('events').where('dateBasis', '==', 'hijri').get();
  if (snap.empty) return;

  let batch = db.batch();
  let opsInBatch = 0;
  const auditEntries = [];

  for (const doc of snap.docs) {
    const before = doc.data();
    if (!before.hijriDate) continue;
    const resolved = resolveBookingDates(before, afterOverrides);
    if (!resolved.resolved || (resolved.startAt === before.startAt && resolved.endAt === before.endAt)) continue;

    const patch = { startAt: resolved.startAt, endAt: resolved.endAt, updatedAt: FieldValue.serverTimestamp() };
    if (ACTIVE_FOR_CONFLICTS.includes(before.status)) {
      const bufferHours = resolveBufferHours(await (async () => {
        const vSnap = await db.collection('venues').doc(before.venueId).get();
        return vSnap.exists ? vSnap.data() : null;
      })());
      const overlaps = await findOverlaps(before.venueId, resolved.startAt, resolved.endAt, doc.id, undefined, bufferHours);
      patch.hasConflict = overlaps.length > 0;
      patch.conflictWith = overlaps.map(o => o.id);
    }

    batch.update(doc.ref, patch);
    opsInBatch += 1;
    auditEntries.push({
      entityType: 'event', entityId: doc.id, action: 'hijri_date_resolved',
      note: 'Resolved Gregorian date updated for a Hijri-sourced booking after a moon-sighting adjustment change.',
      diff: { from: { startAt: before.startAt, endAt: before.endAt }, to: { startAt: resolved.startAt, endAt: resolved.endAt } }
    });

    if (opsInBatch >= 450) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) await batch.commit();
  for (const entry of auditEntries) await writeAudit(entry);
});
