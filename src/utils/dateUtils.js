import { ORG_TIMEZONE } from '../firebase/firebaseConfig';
import { getHijriDisplay } from '../services/hijriService';

/** Combine a date (YYYY-MM-DD) + time (HH:MM) in the org timezone into a UTC ISO string. */
export function localToUtcIso(dateStr, timeStr, timeZone = ORG_TIMEZONE) {
  if (!dateStr || !timeStr) return null;
  // Compute the timezone offset for that specific date/time using Intl, then
  // apply it to a UTC-constructed Date — avoids relying on the server/browser
  // being in the org timezone.
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const tzString = utcGuess.toLocaleString('en-US', { timeZone });
  const tzDate = new Date(tzString);
  const diff = utcGuess.getTime() - tzDate.getTime();
  return new Date(utcGuess.getTime() + diff).toISOString();
}

export function formatInOrgTz(iso, opts = {}) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-AU', { timeZone: ORG_TIMEZONE, ...opts });
}

export function dateKeyInOrgTz(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ORG_TIMEZONE });
}

export function hijriLabel(iso, overrides = []) {
  const key = dateKeyInOrgTz(iso);
  return key ? getHijriDisplay(key, overrides) : '';
}

/** Two [start,end) ranges overlap. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}
