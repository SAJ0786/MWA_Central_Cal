import { ORG_TIMEZONE } from '../firebase/firebaseConfig';
import { getHijriDisplay } from '../services/hijriService';

/** Combine a date (YYYY-MM-DD) + time (HH:MM) in the org timezone into a UTC ISO string.
 * Computed via Intl.DateTimeFormat against an explicit IANA zone, so it is correct
 * regardless of the browser/host's own system timezone (unlike a naive
 * toLocaleString/round-trip diff, which only works when the host itself runs in UTC).
 *
 * Uses a two-pass fixed-point resolution rather than a single offset lookup: a single
 * pass reads the zone's offset at the *naive* UTC stand-in for the wall-clock time, which
 * is wrong within a few hours of a DST transition (the stand-in instant can fall on the
 * other side of the transition to the actual target instant, picking the wrong AEST/AEDT
 * offset and silently shifting the result by an hour). The second pass re-reads the offset
 * at the first pass's result, which converges on the correct offset in all but
 * sub-second edge cases at the transition instant itself. Kept in lockstep with the
 * identical algorithm in functions/dateUtils.js. */
export function localToUtcIso(dateStr, timeStr, timeZone = ORG_TIMEZONE) {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (instant) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(new Date(instant)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const asZoned = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    return asZoned - instant; // how far ahead of UTC the target zone's wall clock reads
  };
  const firstPassOffset = offsetAt(asUtc);
  const refinedOffset = offsetAt(asUtc - firstPassOffset);
  return new Date(asUtc - refinedOffset).toISOString();
}

export function formatInOrgTz(iso, opts = {}) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-AU', { timeZone: ORG_TIMEZONE, ...opts });
}

export function dateKeyInOrgTz(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ORG_TIMEZONE });
}

/** "HH:MM" (24h) for an ISO instant in the org timezone — the client twin of
 * functions/dateUtils.js's toOrgTimeParts. Always use this (never
 * Date#getHours/getMinutes, which read the host/browser's own local
 * timezone) when deriving a time-of-day from a stored UTC instant, e.g. to
 * pre-fill an edit form's time inputs. */
export function timeKeyInOrgTz(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: ORG_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Split an ISO instant into its org-timezone date (YYYY-MM-DD) and time (HH:MM) parts. */
export function toOrgTimeParts(iso) {
  return { dateStr: dateKeyInOrgTz(iso), timeStr: timeKeyInOrgTz(iso) };
}

export function hijriLabel(iso, overrides = []) {
  const key = dateKeyInOrgTz(iso);
  return key ? getHijriDisplay(key, overrides) : '';
}

/** Two [start,end) ranges overlap. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}
