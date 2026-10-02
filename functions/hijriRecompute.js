// Resolves the canonical Gregorian startAt/endAt for a booking from its source
// date, honouring the brief's "preserve source date" requirement:
//   - Gregorian-based bookings (dateBasis 'gregorian'): startAt/endAt are the
//     source of truth and are never recomputed here. Their Hijri equivalent is
//     always re-derived for *display* on the fly (see hijriInfoFor in index.js)
//     so it stays correct as moon-sighting overrides change, without ever
//     moving the booking's actual Gregorian date/time.
//   - Hijri-based bookings (dateBasis 'hijri'): the stored `hijriDate`
//     {day, month, year} is the source of truth. Its resolved Gregorian
//     instant is (re)computed here from the current moon-sighting overrides,
//     preserving the originally-chosen local start/end time-of-day. This is
//     called both at submission time and by the onHijriSettingsChanged
//     trigger whenever the admin adjustment changes, so a Hijri-sourced
//     booking's calendar placement always reflects its fixed Hijri day.
const { adjustedIslamicToGregorian } = require('./hijriService');
const { localToUtcIso, toOrgTimeParts } = require('./dateUtils');

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Resolve the canonical startAt/endAt for an event-like object given the
 * current Hijri overrides. Returns { startAt, endAt, resolved } where
 * `resolved` is true only if a Hijri source date was actually used to derive
 * the result (false/passthrough for Gregorian-based or malformed input).
 */
function resolveBookingDates(data, overrides = []) {
  const passthrough = { startAt: data.startAt, endAt: data.endAt, resolved: false };
  const isHijri = data.dateBasis === 'h' || data.dateBasis === 'hijri';
  const hd = data.hijriDate;
  if (!isHijri || !hd || !hd.day || !hd.month || !hd.year) return passthrough;
  if (!data.startAt || !data.endAt) return passthrough;

  const g = adjustedIslamicToGregorian(Number(hd.year), Number(hd.month), Number(hd.day), overrides);
  if (!g || !g.year) return passthrough;

  const dateStr = `${g.year}-${pad2(g.month)}-${pad2(g.day)}`;
  const { timeStr: startTime } = toOrgTimeParts(data.startAt);
  const { timeStr: endTime } = toOrgTimeParts(data.endAt);
  const startAt = localToUtcIso(dateStr, startTime);
  const endAt = localToUtcIso(dateStr, endTime);
  if (!startAt || !endAt) return passthrough;
  return { startAt, endAt, resolved: true };
}

module.exports = { resolveBookingDates };
