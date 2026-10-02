const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBookingDates } = require('./hijriRecompute');

test('Gregorian-based bookings are always passed through unchanged', () => {
  const data = { dateBasis: 'gregorian', startAt: '2026-10-12T00:00:00.000Z', endAt: '2026-10-12T02:00:00.000Z' };
  const res = resolveBookingDates(data, []);
  assert.equal(res.resolved, false);
  assert.equal(res.startAt, data.startAt);
  assert.equal(res.endAt, data.endAt);
});

test('Hijri-based bookings resolve from the source hijriDate, preserving local time-of-day', () => {
  // 29 Rabi al-Thani 1448 AH resolves to 2026-10-12 with no overrides.
  const data = {
    dateBasis: 'hijri',
    hijriDate: { day: 29, month: 4, year: 1448 },
    // Local (Australia/Sydney) 09:00-10:00 on a placeholder date; only the
    // time-of-day is used, the date portion is re-derived from hijriDate.
    startAt: '2026-01-01T22:00:00.000Z', // 09:00 AEDT
    endAt: '2026-01-01T23:00:00.000Z' // 10:00 AEDT
  };
  const res = resolveBookingDates(data, []);
  assert.equal(res.resolved, true);
  assert.equal(new Date(res.startAt).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }), '2026-10-12');
  // 09:00-10:00 local time-of-day is preserved (1hr apart, same as source).
  assert.equal(new Date(res.endAt) - new Date(res.startAt), 60 * 60 * 1000);
  assert.equal(new Date(res.startAt).toLocaleTimeString('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }), '09:00');
});

test('a moon-sighting override that shifts the Hijri month also shifts a Hijri-based booking', () => {
  const data = {
    dateBasis: 'hijri',
    hijriDate: { day: 1, month: 5, year: 1448 },
    startAt: '2026-01-01T22:00:00.000Z',
    endAt: '2026-01-01T23:00:00.000Z'
  };
  const before = resolveBookingDates(data, []);
  // Anchor 1 Jumada al-Awwal 1448 one day later than the tabular default.
  const overrides = [{ hYear: 1448, hMonth: 5, gDate: '2026-10-14' }];
  const after = resolveBookingDates(data, overrides);
  assert.equal(after.resolved, true);
  assert.notEqual(after.startAt, before.startAt);
  assert.equal(new Date(after.startAt).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }), '2026-10-14');
  // The override shifted the resolved date forward by exactly one day while
  // preserving the local time-of-day.
  assert.equal(new Date(after.startAt) - new Date(before.startAt), 24 * 60 * 60 * 1000);
});

test('a malformed or missing hijriDate falls back to passthrough instead of throwing', () => {
  const noDate = resolveBookingDates({ dateBasis: 'hijri', startAt: 'x', endAt: 'y' }, []);
  assert.equal(noDate.resolved, false);
  const zeroDate = resolveBookingDates({ dateBasis: 'hijri', hijriDate: { day: 0, month: 0, year: 0 }, startAt: 'x', endAt: 'y' }, []);
  assert.equal(zeroDate.resolved, false);
});
