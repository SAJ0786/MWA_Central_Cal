// Pure helpers for venue overlap/buffer logic, kept dependency-free (no
// firebase-admin) so they can be unit-tested in isolation — see conflictUtils.test.js.

/**
 * Safe read-time fallback for the bufferMinutes -> bufferHours rename: prefer
 * bufferHours, else convert a legacy bufferMinutes value, else 0. No destructive
 * Firestore migration is required — every read resolves consistently.
 */
function resolveBufferHours(venueData) {
  if (!venueData) return 0;
  if (venueData.bufferHours !== undefined && venueData.bufferHours !== null) {
    const n = Number(venueData.bufferHours);
    return Number.isFinite(n) ? n : 0;
  }
  if (venueData.bufferMinutes !== undefined && venueData.bufferMinutes !== null) {
    const n = Number(venueData.bufferMinutes);
    return Number.isFinite(n) ? n / 60 : 0;
  }
  return 0;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Post-booking buffer: an *existing* active booking occupies
 * [otherStart, otherEnd + bufferHours] for conflict purposes. The buffer is only
 * applied after the existing booking's end (never before its start), and only to
 * that existing booking — never to the incoming candidate range — so a buffer can
 * never block a new submission, only flag hasConflict/conflictWith.
 */
function rangesOverlapBuffered(candidateStart, candidateEnd, otherStart, otherEnd, bufferHours) {
  const bufferMs = (Number(bufferHours) || 0) * 60 * 60 * 1000;
  const bufferedOtherEnd = new Date(otherEnd).getTime() + bufferMs;
  return new Date(candidateStart).getTime() < bufferedOtherEnd && new Date(candidateEnd).getTime() > new Date(otherStart).getTime();
}

module.exports = { resolveBufferHours, rangesOverlap, rangesOverlapBuffered };
