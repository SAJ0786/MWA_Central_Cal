// Events/bookings service.
//
// Admins read the live `events` collection directly (allowed by
// firestore.rules). Public visitors never read/write that collection
// directly — they go through Cloud Functions so conflict checks and
// visibility filtering are always enforced server-side, not just in the UI.
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/firebase';

/** Admin-only live view of every booking (any status/visibility). */
export function watchAllEvents(callback, onError) {
  const q = query(collection(db, 'events'), orderBy('startAt'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
}

/**
 * Public submission. Always lands as status "pending" — the server decides
 * conflict flags; a conflict NEVER blocks the request, it only flags it for
 * the admin to review (see the brief's conflict-handling requirement).
 */
export async function submitBooking(payload) {
  const fn = httpsCallable(functions, 'submitBooking');
  const res = await fn(payload);
  return res.data;
}

/** Admin decision: confirm / reject / cancel, with optional visibility + note. */
export async function decideBooking({ eventId, status, visibility, note }) {
  const fn = httpsCallable(functions, 'decideBooking');
  const res = await fn({ eventId, status, visibility, note });
  return res.data;
}

/** Admin edit of an existing booking's core fields (re-runs conflict check). */
export async function updateBooking(eventId, patch) {
  const fn = httpsCallable(functions, 'updateBooking');
  const res = await fn({ eventId, patch });
  return res.data;
}

/** Public, read-only, sanitized events for the public calendar (no auth). */
export async function fetchPublicEvents({ from, to } = {}) {
  const fn = httpsCallable(functions, 'getPublicEvents');
  const res = await fn({ from, to });
  return res.data?.events || [];
}

/** Admin edit; `scope` ('single' | 'future' | 'all') applies shared fields/time-of-day across a recurring series. */
export async function updateBookingScoped(eventId, patch, scope = 'single') {
  const fn = httpsCallable(functions, 'updateBooking');
  const res = await fn({ eventId, patch, scope });
  return res.data;
}

/** Admin-only: create a recurring series (expanded + conflict-flagged server-side). */
export async function createRecurringBooking(payload) {
  const fn = httpsCallable(functions, 'createRecurringBooking');
  const res = await fn(payload);
  return res.data;
}

/** Admin-only: delete one occurrence, this & future, or the whole series. */
export async function deleteBooking(eventId, scope = 'single') {
  const fn = httpsCallable(functions, 'deleteBooking');
  const res = await fn({ eventId, scope });
  return res.data;
}

async function call(name, data) {
  const res = await httpsCallable(functions, name)(data);
  return res.data;
}

/** Live conflict check. Public callers get { hasConflict, count } only; admins also get the list. */
export const checkSlotConflicts = (payload) => call('checkSlotConflicts', payload);

/** Admin-only: exact occurrence list + per-occurrence conflicts, before creating a series. */
export const previewRecurringBooking = (payload) => call('previewRecurringBooking', payload);

/** Admin-only: Excel import (`dryRun: true` validates only). */
export const importBookings = (rows, dryRun) => call('importBookings', { rows, dryRun });

/** Admin-only: recompute every stored overlap flag (buffer-aware, symmetric). */
export const recomputeAllConflicts = () => call('recomputeAllConflicts', {});
