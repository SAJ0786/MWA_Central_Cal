const test = require('node:test');
const assert = require('node:assert/strict');
const { MIN_PUBLIC_LEAD_MS, isPublicStartAllowed, validateBookingLeadTime } = require('./publicLeadTime');
const { localToUtcIso } = require('./dateUtils');
const { adjustedGregorianToIslamic } = require('./hijriService');
const { resolveBookingDates } = require('./hijriRecompute');

test('public start must be at least six hours ahead; exact boundary is allowed', () => {
  const now = Date.parse('2026-10-03T02:00:00.000Z');
  assert.equal(isPublicStartAllowed(new Date(now + MIN_PUBLIC_LEAD_MS).toISOString(), now), true);
  assert.equal(isPublicStartAllowed(new Date(now + MIN_PUBLIC_LEAD_MS - 1).toISOString(), now), false);
  assert.equal(isPublicStartAllowed(new Date(now + MIN_PUBLIC_LEAD_MS + 1).toISOString(), now), true);
});

test('Sydney civil time check remains six elapsed hours across the DST transition', () => {
  // 2026-10-04 clocks jump from 02:00 to 03:00 Sydney time.
  const now = Date.parse('2026-10-03T15:30:00.000Z'); // 04 Oct 2026, 01:30 AEST (before the clock jump)
  const valid = localToUtcIso('2026-10-04', '09:00'); // 04 Oct, 09:00 AEDT
  const tooSoon = localToUtcIso('2026-10-04', '08:29'); // less than six elapsed hours
  assert.equal(isPublicStartAllowed(valid, now), true);
  assert.equal(isPublicStartAllowed(tooSoon, now), false);
});

test('malformed start is rejected', () => {
  assert.equal(isPublicStartAllowed('not-a-date'), false);
});

test('admin exemption permits historical edits while public submissions are rejected', () => {
  const past = '2026-01-01T00:00:00.000Z';
  assert.equal(validateBookingLeadTime(past, false, Date.parse('2026-01-02T00:00:00.000Z')), false);
  assert.equal(validateBookingLeadTime(past, true, Date.parse('2026-01-02T00:00:00.000Z')), true);
});

test('a resolved past Hijri date is rejected using its Gregorian instant', () => {
  const h = adjustedGregorianToIslamic(2026, 10, 2, []);
  const data = {
    dateBasis: 'hijri',
    hijriDate: { day: h.day, month: h.month, year: h.year },
    startAt: localToUtcIso('2026-10-02', '10:00'),
    endAt: localToUtcIso('2026-10-02', '11:00')
  };
  const resolved = resolveBookingDates(data, []);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.startAt, localToUtcIso('2026-10-02', '10:00'));
  assert.equal(isPublicStartAllowed(resolved.startAt, Date.parse('2026-10-03T08:01:00.000Z')), false);
});
