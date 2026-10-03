import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustPublicBookingStart, earliestAllowedPublicStart, MIN_PUBLIC_LEAD_MS } from './publicLeadTime.js';
import { localToUtcIso, toOrgTimeParts } from '../../functions/dateUtils.js';

function addDays(key, amount) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}
const conversions = { localToUtcIso, toOrgTimeParts, addDays };

test('rounds now + six hours up to the next 15-minute boundary', () => {
  const now = Date.parse('2026-10-03T07:01:00.000Z');
  assert.equal(new Date(earliestAllowedPublicStart(now)).toISOString(), '2026-10-03T13:15:00.000Z');
  assert.equal(earliestAllowedPublicStart(now) >= now + MIN_PUBLIC_LEAD_MS, true);
});

test('past Gregorian booking is moved to the earliest permitted Sydney start and duration is preserved', () => {
  const now = Date.parse('2026-10-03T08:01:00.000Z'); // 18:01 Sydney
  const patch = adjustPublicBookingStart({
    date: '2026-10-03', start: '09:00', end: '10:30', endNextDay: false,
    timeMode: 'custom', nowMs: now, ...conversions
  });
  assert.deepEqual(patch, { date: '2026-10-04', start: '00:15', end: '01:45', endNextDay: false });
});

test('Hijri-resolved past date uses the same Gregorian instant policy', () => {
  // Hijri resolution happens before this helper; it receives the resolved Gregorian date.
  const patch = adjustPublicBookingStart({
    date: '2026-10-02', start: '10:00', end: '11:00', endNextDay: false,
    timeMode: 'custom', nowMs: Date.parse('2026-10-03T08:01:00.000Z'), ...conversions
  });
  assert.equal(patch.date, '2026-10-04');
  assert.equal(patch.start, '00:15');
});

test('when earliest start rounds over midnight, date advances and overnight duration remains valid', () => {
  const now = Date.parse('2026-10-03T13:59:00.000Z'); // 04 Oct 00:59 AEDT; +6h rounds to 07:00
  const patch = adjustPublicBookingStart({
    date: '2026-10-04', start: '00:00', end: '01:00', endNextDay: false,
    timeMode: 'custom', nowMs: now, ...conversions
  });
  assert.deepEqual(patch, { date: '2026-10-04', start: '07:00', end: '08:00', endNextDay: false });
});

test('all-day and all-night slots move to a whole permitted day/night', () => {
  const now = Date.parse('2026-10-03T07:01:00.000Z'); // 18:01 Sydney; today's day start has passed
  assert.deepEqual(adjustPublicBookingStart({
    date: '2026-10-03', start: '00:00', end: '23:59', endNextDay: false,
    timeMode: 'allDay', nowMs: now, ...conversions
  }), { date: '2026-10-04', start: '00:00', end: '23:59', endNextDay: false });
  assert.deepEqual(adjustPublicBookingStart({
    date: '2026-10-03', start: '18:00', end: '06:00', endNextDay: true,
    timeMode: 'allNight', nowMs: now, ...conversions
  }), { date: '2026-10-04', start: '18:00', end: '06:00', endNextDay: true });
});

test('starts already beyond the six-hour window remain unchanged', () => {
  const now = Date.parse('2026-10-03T07:01:00.000Z');
  assert.equal(adjustPublicBookingStart({
    date: '2026-10-04', start: '12:00', end: '13:00', endNextDay: false,
    timeMode: 'custom', nowMs: now, ...conversions
  }), null);
});

test('invalid end is replaced with a one-hour duration when a past/too-soon start is adjusted', () => {
  const patch = adjustPublicBookingStart({
    date: '2026-10-03', start: '09:00', end: '', endNextDay: false,
    timeMode: 'custom', nowMs: Date.parse('2026-10-03T08:01:00.000Z'), ...conversions
  });
  assert.equal(patch.date, '2026-10-04');
  assert.equal(patch.end, '01:15');
  assert.equal(patch.endNextDay, false);
});
