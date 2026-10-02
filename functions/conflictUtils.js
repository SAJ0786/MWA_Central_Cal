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

/**
 * Symmetric conflict between two bookings at the same venue: each booking occupies
 * [start, end + buffer], so the pair conflicts if either one's occupancy overlaps the
 * other's booked time. This is the same "existing booking occupies [start, end+buffer]"
 * rule applied in both directions, so the result never depends on which was created first.
 */
function rangesConflict(a, b, bufferHours) {
  return rangesOverlapBuffered(a.startAt, a.endAt, b.startAt, b.endAt, bufferHours)
    || rangesOverlapBuffered(b.startAt, b.endAt, a.startAt, a.endAt, bufferHours);
}

/**
 * Pure conflict map for a venue's active (pending/confirmed) bookings:
 * Map<id, string[]> of the other bookings each one conflicts with.
 */
function computeConflictMap(events, bufferHours) {
  const sorted = [...events].sort((x, y) => String(x.startAt).localeCompare(String(y.startAt)));
  const map = new Map(sorted.map(e => [e.id, []]));
  const bufferMs = (Number(bufferHours) || 0) * 3600000;
  let maxReach = -Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i];
    const bStart = new Date(b.startAt).getTime();
    // Nothing earlier in start order can reach this booking: skip the scan entirely.
    if (bStart >= maxReach) { maxReach = Math.max(maxReach, new Date(b.endAt).getTime() + bufferMs); continue; }
    for (let j = 0; j < i; j += 1) {
      const a = sorted[j];
      if (rangesConflict(a, b, bufferHours)) {
        map.get(a.id).push(b.id);
        map.get(b.id).push(a.id);
      }
    }
    maxReach = Math.max(maxReach, new Date(b.endAt).getTime() + bufferMs);
  }
  return map;
}

module.exports = { resolveBufferHours, rangesOverlap, rangesOverlapBuffered, rangesConflict, computeConflictMap };
