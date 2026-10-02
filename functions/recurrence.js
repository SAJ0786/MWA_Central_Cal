// Server-side recurrence expansion for recurring bookings.
//
// Modelled on the Community Events app's recurrence rules (SAJ0786/CommunityEvents-Native,
// src/services/recurrence.js): frequencies day/week/month/year, "repeat every N"
// (1-100), end by date or by occurrence count, a hard one-year horizon for
// daily/weekly/monthly series, and a 5-occurrence cap for yearly series.
//
// Differences, all deliberate:
//  - Occurrence instants are built with localToUtcIso (Australia/Sydney civil time,
//    DST-safe), so "12:00-16:00" stays 12:00-16:00 on both sides of a DST change.
//  - Gregorian month/year steps are always computed from the *first* date (not by
//    chaining), so 31 Jan -> 28 Feb -> 31 Mar rather than drifting to the 28th.
//  - Hijri month/year steps clamp to the real (29/30-day, override-aware) month length.
//    Hijri day/week steps are plain day offsets on the resolved Gregorian start date
//    (a Hijri "30-day month" assumption would drift from the real calendar); each
//    occurrence's own Hijri date is then derived and stored as its anchor.
//  - Every Hijri-based occurrence carries its own {day, month, year} anchor, so the
//    existing onHijriSettingsChanged trigger keeps each one pinned to its Hijri day.
const { localToUtcIso } = require('./dateUtils');
const {
  adjustedGregorianToIslamic,
  adjustedIslamicToGregorian,
  getHijriMonthLength
} = require('./hijriService');

const FREQUENCIES = ['day', 'week', 'month', 'year'];
const MAX_OCCURRENCES = 370;
const MAX_YEARLY_OCCURRENCES = 5;
const MAX_REPEAT_EVERY = 100;

class RecurrenceError extends Error {}

const pad2 = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

function addDaysKey(key, days) {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addMonthsClampedKey(key, months) {
  const { y, m, d } = parseKey(key);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const maxDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return keyOf(ny, nm, Math.min(d, maxDay));
}

function validateTime(value, label) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!match) throw new RecurrenceError(`${label} must be a time in HH:MM format.`);
  return value;
}

function toHijriParts(dateKey, overrides) {
  const { y, m, d } = parseKey(dateKey);
  const h = adjustedGregorianToIslamic(y, m, d, overrides);
  return h && h.year ? { day: h.day, month: h.month, year: h.year } : null;
}

/**
 * Expand a recurrence rule into concrete occurrences.
 * @param {object} rule
 *  basis: 'gregorian' | 'hijri'
 *  startDate: 'YYYY-MM-DD' (gregorian basis)  | hijriStart: {day, month, year} (hijri basis)
 *  startTime/endTime: 'HH:MM' Australia/Sydney wall-clock times (same civil day)
 *  frequency: day|week|month|year, repeatEvery: 1..100
 *  endMode: 'count' (count) | 'date' (endDate, Gregorian 'YYYY-MM-DD', inclusive)
 * @returns {{index:number,dateKey:string,startAt:string,endAt:string,hijriDate:object|null}[]}
 */
function generateOccurrences(rule, overrides = []) {
  const r = rule || {};
  if (!FREQUENCIES.includes(r.frequency)) throw new RecurrenceError('Please choose a valid recurrence frequency.');
  const step = Number(r.repeatEvery);
  if (!Number.isInteger(step) || step < 1 || step > MAX_REPEAT_EVERY) {
    throw new RecurrenceError(`Repeat frequency must be a whole number between 1 and ${MAX_REPEAT_EVERY}.`);
  }
  validateTime(r.startTime, 'Start time');
  validateTime(r.endTime, 'End time');
  const endNextDay = r.endNextDay === true;
  // An overnight window (e.g. All night 18:00 -> 06:00) ends on the following civil day.
  if (!endNextDay && r.endTime <= r.startTime) throw new RecurrenceError('End time must be after start time.');

  const isHijri = r.basis === 'hijri';
  let startKey;
  let hijriStart = null;
  if (isHijri) {
    const hs = r.hijriStart || {};
    hijriStart = { day: Number(hs.day), month: Number(hs.month), year: Number(hs.year) };
    if (!Number.isInteger(hijriStart.day) || hijriStart.day < 1 || hijriStart.day > 30
      || !Number.isInteger(hijriStart.month) || hijriStart.month < 1 || hijriStart.month > 12
      || !Number.isInteger(hijriStart.year) || hijriStart.year < 1) {
      throw new RecurrenceError('Please enter a valid Hijri start date.');
    }
    const g = adjustedIslamicToGregorian(hijriStart.year, hijriStart.month, hijriStart.day, overrides);
    if (!g || !g.year) throw new RecurrenceError('Could not convert the Hijri start date.');
    startKey = keyOf(g.year, g.month, g.day);
  } else {
    if (!parseKey(r.startDate)) throw new RecurrenceError('Please select the first booking date.');
    startKey = r.startDate;
  }

  const hardEnd = addMonthsClampedKey(startKey, r.frequency === 'year' ? 48 : 12);
  const maxCount = r.frequency === 'year' ? MAX_YEARLY_OCCURRENCES : MAX_OCCURRENCES;
  const byDate = r.endMode === 'date';
  const byCount = r.endMode === 'count';
  if (!byDate && !byCount) throw new RecurrenceError('Please choose how the recurring booking should end.');

  let endKey = hardEnd;
  let countLimit = maxCount;
  if (byDate) {
    if (!parseKey(r.endDate)) throw new RecurrenceError('Please select an end date.');
    if (r.endDate < startKey) throw new RecurrenceError('End date must not be before the first booking date.');
    if (r.endDate > hardEnd) {
      throw new RecurrenceError(r.frequency === 'year'
        ? 'Yearly recurring bookings can only generate 5 occurrences.'
        : 'Daily, weekly and monthly recurring bookings cannot go beyond one year.');
    }
    endKey = r.endDate;
  } else {
    countLimit = Number(r.count);
    if (!Number.isInteger(countLimit) || countLimit < 1) throw new RecurrenceError('Please enter a valid number of occurrences.');
    if (countLimit > maxCount) {
      throw new RecurrenceError(r.frequency === 'year'
        ? 'Yearly recurring bookings can have a maximum of 5 occurrences.'
        : `Recurring bookings can have a maximum of ${MAX_OCCURRENCES} occurrences.`);
    }
  }

  const occurrences = [];
  for (let i = 0; occurrences.length < countLimit; i += 1) {
    let dateKey;
    let hijriDate = null;
    if (isHijri && (r.frequency === 'month' || r.frequency === 'year')) {
      const monthsToAdd = (r.frequency === 'month' ? step : step * 12) * i;
      const total = hijriStart.year * 12 + (hijriStart.month - 1) + monthsToAdd;
      const hy = Math.floor(total / 12);
      const hm = (total % 12) + 1;
      const len = getHijriMonthLength(hy, hm, overrides);
      hijriDate = { day: Math.min(hijriStart.day, len), month: hm, year: hy };
      const g = adjustedIslamicToGregorian(hy, hm, hijriDate.day, overrides);
      if (!g || !g.year) break;
      dateKey = keyOf(g.year, g.month, g.day);
    } else if (r.frequency === 'day' || r.frequency === 'week') {
      dateKey = addDaysKey(startKey, i * step * (r.frequency === 'week' ? 7 : 1));
    } else {
      dateKey = addMonthsClampedKey(startKey, (r.frequency === 'month' ? step : step * 12) * i);
    }
    if (dateKey > hardEnd || (byDate && dateKey > endKey)) break;
    if (isHijri && !hijriDate) hijriDate = toHijriParts(dateKey, overrides);
    occurrences.push({
      index: occurrences.length,
      dateKey,
      startAt: localToUtcIso(dateKey, r.startTime),
      endAt: localToUtcIso(endNextDay ? addDaysKey(dateKey, 1) : dateKey, r.endTime),
      hijriDate: isHijri ? hijriDate : null,
      hijriDisplay: hijriDate || toHijriParts(dateKey, overrides)
    });
  }

  if (byCount && occurrences.length < countLimit) {
    throw new RecurrenceError(r.frequency === 'year'
      ? 'Yearly recurring bookings can only generate 5 occurrences.'
      : 'The requested occurrences go beyond one year. Reduce the occurrence count or increase the repeat interval.');
  }
  if (!occurrences.length) throw new RecurrenceError('The recurrence rule produced no occurrences.');
  return occurrences;
}

module.exports = {
  generateOccurrences,
  RecurrenceError,
  FREQUENCIES,
  MAX_OCCURRENCES,
  MAX_YEARLY_OCCURRENCES,
  MAX_REPEAT_EVERY
};
