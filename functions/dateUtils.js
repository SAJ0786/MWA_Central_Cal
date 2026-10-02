// Shared date/timezone helpers for Cloud Functions. Pure, dependency-free so
// they can be unit-tested directly (see hijriRecompute.test.js) and ported in
// lockstep with the client's src/utils/dateUtils.js.
const ORG_TIMEZONE = 'Australia/Sydney';

/** Combine a date (YYYY-MM-DD) + time (HH:MM) in the org timezone into a UTC ISO string.
 * Computed via Intl.DateTimeFormat against an explicit IANA zone, so it is correct
 * regardless of the host process's own system timezone (unlike a naive
 * toLocaleString/round-trip diff, which only works when the process itself runs in UTC).
 *
 * Uses a two-pass fixed-point resolution rather than a single offset lookup: a single
 * pass reads the zone's offset at the *naive* UTC stand-in for the wall-clock time, which
 * is wrong within a few hours of a DST transition (the stand-in instant can fall on the
 * other side of the transition to the actual target instant, picking the wrong AEST/AEDT
 * offset and silently shifting the result by an hour). The second pass re-reads the offset
 * at the first pass's result, which converges on the correct offset in all but
 * sub-second edge cases at the transition instant itself. */
function localToUtcIso(dateStr, timeStr, timeZone = ORG_TIMEZONE) {
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

/** Split an ISO instant into its org-timezone date (YYYY-MM-DD) and time (HH:MM) parts. */
function toOrgTimeParts(iso, timeZone = ORG_TIMEZONE) {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('en-CA', { timeZone });
  const timeStr = d.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  return { dateStr, timeStr };
}

module.exports = { ORG_TIMEZONE, localToUtcIso, toOrgTimeParts };
