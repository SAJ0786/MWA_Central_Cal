const { minimumPublicLeadHours: MIN_PUBLIC_LEAD_HOURS } = require('./calendarPolicy.json');
const MIN_PUBLIC_LEAD_MS = MIN_PUBLIC_LEAD_HOURS * 60 * 60 * 1000;

function isPublicStartAllowed(startAt, now = Date.now()) {
  const startMs = new Date(startAt).getTime();
  return Number.isFinite(startMs) && startMs >= now + MIN_PUBLIC_LEAD_MS;
}

function validateBookingLeadTime(startAt, isAdmin, now = Date.now()) {
  return isAdmin || isPublicStartAllowed(startAt, now);
}

module.exports = { MIN_PUBLIC_LEAD_HOURS, MIN_PUBLIC_LEAD_MS, isPublicStartAllowed, validateBookingLeadTime };
