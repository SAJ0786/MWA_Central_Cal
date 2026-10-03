import policy from '../../functions/calendarPolicy.json' with { type: 'json' };

export const MIN_PUBLIC_LEAD_HOURS = policy.minimumPublicLeadHours;
export const MIN_PUBLIC_LEAD_MS = MIN_PUBLIC_LEAD_HOURS * 60 * 60 * 1000;
const QUARTER_HOUR_MS = 15 * 60 * 1000;

export function earliestAllowedPublicStart(nowMs = Date.now()) {
  return Math.ceil((nowMs + MIN_PUBLIC_LEAD_MS) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

/**
 * Returns a form patch if its start is too soon, otherwise null.
 * Date conversion functions are injected so the policy can be tested without a browser/runtime zone.
 */
export function adjustPublicBookingStart({
  date, start, end, endNextDay, timeMode, nowMs = Date.now(),
  localToUtcIso, toOrgTimeParts, addDays
}) {
  if (!date || !start) return null;
  const startAt = localToUtcIso(date, start);
  if (!startAt) return null;

  const earliest = earliestAllowedPublicStart(nowMs);
  if (new Date(startAt).getTime() >= earliest) return null;

  if (timeMode === 'allDay' || timeMode === 'allNight') {
    const fixedStart = timeMode === 'allDay' ? '00:00' : '18:00';
    const fixedEnd = timeMode === 'allDay' ? '23:59' : '06:00';
    const fixedEndNextDay = timeMode === 'allNight';
    let candidateDate = date;
    for (let i = 0; i < 3; i += 1) {
      const candidateStart = localToUtcIso(candidateDate, fixedStart);
      if (candidateStart && new Date(candidateStart).getTime() >= earliest) {
        return {
          date: candidateDate,
          start: fixedStart,
          end: fixedEnd,
          endNextDay: fixedEndNextDay
        };
      }
      candidateDate = addDays(candidateDate, 1);
    }
  }

  const endAt = end ? localToUtcIso(endNextDay ? addDays(date, 1) : date, end) : null;
  const candidateDuration = endAt ? new Date(endAt).getTime() - new Date(startAt).getTime() : 0;
  const durationMs = candidateDuration > 0 ? candidateDuration : 60 * 60 * 1000;
  const adjustedStartMs = earliestAllowedPublicStart(nowMs);
  const adjustedEndMs = adjustedStartMs + durationMs;
  const adjustedStart = toOrgTimeParts(new Date(adjustedStartMs).toISOString());
  const adjustedEnd = toOrgTimeParts(new Date(adjustedEndMs).toISOString());
  return {
    date: adjustedStart.dateStr,
    start: adjustedStart.timeStr,
    end: adjustedEnd.timeStr,
    endNextDay: adjustedEnd.dateStr !== adjustedStart.dateStr
  };
}
