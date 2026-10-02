// Regression coverage for the "booking times shifting" bug (e.g. a Sydney
// 12:00-16:00 booking rendering/round-tripping as 23:00-03:00): localToUtcIso
// and toOrgTimeParts must be correct for both AEST (UTC+10, southern winter)
// and AEDT (UTC+11, daylight saving) — not just incidentally correct for
// whatever date the host machine happens to run on. The client's
// src/utils/dateUtils.js intentionally ports the exact same Intl-based
// algorithm (see its header comment) but can't be unit-tested directly here
// because it imports Vite's `import.meta.env`; this suite is the source of
// truth for both implementations' correctness.
const test = require('node:test');
const assert = require('node:assert/strict');
const { localToUtcIso, toOrgTimeParts, ORG_TIMEZONE } = require('./dateUtils');

test('localToUtcIso: AEDT (daylight saving, UTC+11) — 12:00-16:00 Sydney stays 12:00-16:00, not 23:00-03:00', () => {
  // Sydney's 2026 DST start is Sunday 4 Oct 2026; 10 Oct is safely within AEDT.
  const startIso = localToUtcIso('2026-10-10', '12:00');
  const endIso = localToUtcIso('2026-10-10', '16:00');
  assert.equal(startIso, '2026-10-10T01:00:00.000Z'); // 12:00 AEDT (UTC+11) == 01:00 UTC
  assert.equal(endIso, '2026-10-10T05:00:00.000Z');
  assert.equal(toOrgTimeParts(startIso).timeStr, '12:00');
  assert.equal(toOrgTimeParts(endIso).timeStr, '16:00');
  assert.equal(toOrgTimeParts(startIso).dateStr, '2026-10-10');
});

test('localToUtcIso: AEST (southern winter, UTC+10) — 12:00-16:00 Sydney round-trips correctly', () => {
  // 15 July is firmly within AEST (no daylight saving in the southern winter).
  const startIso = localToUtcIso('2026-07-15', '12:00');
  const endIso = localToUtcIso('2026-07-15', '16:00');
  assert.equal(startIso, '2026-07-15T02:00:00.000Z'); // 12:00 AEST (UTC+10) == 02:00 UTC
  assert.equal(endIso, '2026-07-15T06:00:00.000Z');
  assert.equal(toOrgTimeParts(startIso).timeStr, '12:00');
  assert.equal(toOrgTimeParts(endIso).timeStr, '16:00');
});

test('toOrgTimeParts: reads Sydney wall-clock time regardless of host timezone (never Date#getHours/getMinutes)', () => {
  // A UTC instant that is evening in UTC but already the *next* Sydney day —
  // the exact shape of bug that host-local extraction (Date#getHours) gets
  // wrong, because it reads the process's own system timezone instead of an
  // explicit zone.
  const iso = '2026-10-09T23:30:00.000Z'; // = 2026-10-10 10:30 AEDT
  const { dateStr, timeStr } = toOrgTimeParts(iso);
  assert.equal(dateStr, '2026-10-10');
  assert.equal(timeStr, '10:30');
});

test('localToUtcIso + toOrgTimeParts round-trip across the DST transition date', () => {
  // Sydney's 2026 DST start: Sunday 4 Oct 2026, clocks forward at 2am -> 3am.
  // A booking the evening before (AEST) and the evening after (AEDT) must
  // each resolve to their own correct offset.
  const beforeDst = localToUtcIso('2026-10-03', '20:00'); // AEST, UTC+10
  const afterDst = localToUtcIso('2026-10-05', '20:00'); // AEDT, UTC+11
  assert.equal(beforeDst, '2026-10-03T10:00:00.000Z');
  assert.equal(afterDst, '2026-10-05T09:00:00.000Z');
  assert.equal(toOrgTimeParts(beforeDst).timeStr, '20:00');
  assert.equal(toOrgTimeParts(afterDst).timeStr, '20:00');
});

test('ORG_TIMEZONE is Australia/Sydney', () => {
  assert.equal(ORG_TIMEZONE, 'Australia/Sydney');
});
