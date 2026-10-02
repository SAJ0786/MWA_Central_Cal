const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBufferHours, rangesConflict, computeConflictMap } = require('./conflictUtils');
const { localToUtcIso } = require('./dateUtils');
const { validateImportRows, normaliseDate, normaliseTime } = require('./bookingImport');
const { generateOccurrences } = require('./recurrence');
const { selectSeriesTargets, retimeOccurrence } = require('./seriesScope');
const { projectPublicEvent } = require('./publicProjection');

// Real data shapes from the live Main Hall venue (both fields present; legacy value is junk).
const MAIN_HALL = { name: 'Main Hall', bufferMinutes: 3, bufferHours: 3 };

const cricket = { id: 'c', startAt: localToUtcIso('2026-10-05', '10:30'), endAt: localToUtcIso('2026-10-05', '15:00'), status: 'confirmed' };
const seminar = { id: 's', startAt: localToUtcIso('2026-10-05', '16:00'), endAt: localToUtcIso('2026-10-05', '20:00'), status: 'pending' };

test('screenshot scenario: 16:00 seminar conflicts with 10:30-15:00 booking under a 3h buffer', () => {
  const buffer = resolveBufferHours(MAIN_HALL);
  assert.equal(buffer, 3);
  assert.equal(rangesConflict(cricket, seminar, buffer), true);
  const map = computeConflictMap([cricket, seminar], buffer);
  assert.deepEqual(map.get('c'), ['s']);
  assert.deepEqual(map.get('s'), ['c']);
});

test('same pair is clear with a 0h buffer, or when the seminar starts after end + buffer', () => {
  assert.equal(rangesConflict(cricket, seminar, 0), false);
  const later = { id: 'l', startAt: localToUtcIso('2026-10-05', '18:00'), endAt: localToUtcIso('2026-10-05', '20:00') };
  assert.equal(rangesConflict(cricket, later, 3), false); // starts exactly at end + buffer
  const justBefore = { ...later, startAt: localToUtcIso('2026-10-05', '17:59') };
  assert.equal(rangesConflict(cricket, justBefore, 3), true);
});

test('legacy venue with only bufferMinutes still produces the conflict', () => {
  const legacy = { name: 'Old Hall', bufferMinutes: 180 };
  assert.equal(resolveBufferHours(legacy), 3);
  assert.equal(rangesConflict(cricket, seminar, resolveBufferHours(legacy)), true);
});

test('conflict is symmetric: an earlier booking ending inside a later booking buffer window is flagged both ways', () => {
  const early = { id: 'e', startAt: localToUtcIso('2026-10-05', '08:00'), endAt: localToUtcIso('2026-10-05', '09:30') };
  assert.equal(rangesConflict(early, cricket, 1), false);
  assert.equal(rangesConflict(early, cricket, 2), true);
  assert.equal(rangesConflict(cricket, early, 2), true);
});

test('computeConflictMap handles chains and far-apart bookings', () => {
  const a = { id: 'a', startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-01T02:00:00.000Z' };
  const b = { id: 'b', startAt: '2026-01-01T03:00:00.000Z', endAt: '2026-01-01T04:00:00.000Z' };
  const c = { id: 'c', startAt: '2026-06-01T00:00:00.000Z', endAt: '2026-06-01T01:00:00.000Z' };
  const map = computeConflictMap([c, b, a], 2);
  assert.deepEqual(map.get('a'), ['b']);
  assert.deepEqual(map.get('c'), []);
});

// ── All day / all night ─────────────────────────────────────────────────────
test('overnight (all night) series ends on the next civil day and is DST-safe', () => {
  const occ = generateOccurrences({
    basis: 'gregorian', startDate: '2026-10-03', startTime: '18:00', endTime: '06:00', endNextDay: true,
    frequency: 'day', repeatEvery: 1, endMode: 'count', count: 3
  });
  assert.equal(occ[0].endAt, localToUtcIso('2026-10-04', '06:00'));
  // 3 Oct is AEST (+10); 4 Oct 06:00 is AEDT (+11): the interval is 11h, not 12h.
  assert.equal((Date.parse(occ[0].endAt) - Date.parse(occ[0].startAt)) / 3600000, 11);
  assert.ok(occ.every(o => o.endAt > o.startAt));
});

test('without endNextDay an end before the start is rejected', () => {
  assert.throws(() => generateOccurrences({
    basis: 'gregorian', startDate: '2026-10-03', startTime: '18:00', endTime: '06:00',
    frequency: 'day', repeatEvery: 1, endMode: 'count', count: 2
  }), /End time must be after start time/);
});

test('retimeOccurrence supports the overnight window', () => {
  const r = retimeOccurrence({ startAt: localToUtcIso('2026-11-02', '09:00') }, '18:00', '06:00', true);
  assert.equal(r.endAt, localToUtcIso('2026-11-03', '06:00'));
});

test('overnight booking conflicts with a next-morning booking', () => {
  const night = { id: 'n', startAt: localToUtcIso('2026-11-02', '18:00'), endAt: localToUtcIso('2026-11-03', '06:00') };
  const morning = { id: 'm', startAt: localToUtcIso('2026-11-03', '05:00'), endAt: localToUtcIso('2026-11-03', '07:00') };
  assert.equal(rangesConflict(night, morning, 0), true);
});

// ── Past occurrences are immutable under multi-occurrence scopes ────────────
test('future/all scopes skip occurrences that already started', () => {
  const now = '2026-10-10T00:00:00.000Z';
  const docs = ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']
    .map((d, i) => ({ id: `e${i}`, seriesId: 'S', startAt: `${d}T01:00:00.000Z` }));
  const all = selectSeriesTargets(docs, docs[2], 'all', now).map(d => d.id);
  assert.deepEqual(all, ['e2', 'e3']);
  const future = selectSeriesTargets(docs, docs[0], 'future', now).map(d => d.id);
  assert.deepEqual(future, ['e2', 'e3']);
  // A past anchor is not itself a target of a multi-occurrence scope.
  assert.ok(!selectSeriesTargets(docs, docs[1], 'all', now).some(d => d.id === 'e1'));
  // Single scope is unaffected.
  assert.deepEqual(selectSeriesTargets(docs, docs[0], 'single', now).map(d => d.id), ['e0']);
});

// ── Import validation ───────────────────────────────────────────────────────
const ctx = () => ({
  departments: [{ id: 'd1', name: 'Youth' }],
  venues: [{ id: 'v1', name: 'Main Hall' }],
  existingById: { ex1: { title: 'Old' } },
  existingKeys: new Set()
});
const goodRow = { Title: 'Cricket', Department: 'youth', Venue: 'main hall', Date: '2026-10-05', Start: '10:30', End: '15:00' };

test('import: valid row defaults to confirmed + public and Sydney time', () => {
  const res = validateImportRows([goodRow], ctx());
  assert.equal(res.errors.length, 0);
  const row = res.rows[0];
  assert.equal(row.action, 'create');
  assert.equal(row.data.status, 'confirmed');
  assert.equal(row.data.visibility, 'public');
  assert.equal(row.data.startAt, localToUtcIso('2026-10-05', '10:30'));
  assert.equal(row.data.departmentId, 'd1');
});

test('import: row-level errors for unknown names, bad dates/times/status/email', () => {
  const res = validateImportRows([
    { ...goodRow, Department: 'Nope' },
    { ...goodRow, Date: 'soon' },
    { ...goodRow, Start: '25:00' },
    { ...goodRow, Status: 'maybe' },
    { ...goodRow, 'Contact Email': 'not-an-email' },
    goodRow
  ], ctx());
  assert.equal(res.errors.length, 5);
  assert.deepEqual(res.errors.map(e => e.row), [2, 3, 4, 5, 6]);
  assert.match(res.errors[0].message, /Unknown department/);
  assert.equal(res.rows.length, 1);
});

test('import: id updates, unknown id creates with warning, duplicates skip (idempotent)', () => {
  const c = ctx();
  const first = validateImportRows([{ ...goodRow, Id: 'ex1' }, { ...goodRow, Id: 'zzz' }], c);
  assert.equal(first.rows[0].action, 'update');
  assert.equal(first.rows[0].id, 'ex1');
  assert.equal(first.rows[1].action, 'create');
  assert.match(first.rows[1].warnings[0], /not found/);
  const key = `v1|${first.rows[0].data.startAt}|${first.rows[0].data.endAt}|cricket`;
  c.existingKeys.add(key);
  const second = validateImportRows([goodRow, goodRow], c);
  assert.deepEqual(second.rows.map(r => r.action), ['skip', 'skip']);
});

test('import: Excel serial dates/times, DD/MM/YYYY and overnight rows', () => {
  assert.equal(normaliseDate(46300), '2026-10-05');
  assert.equal(normaliseDate('05/10/2026'), '2026-10-05');
  assert.equal(normaliseDate('31/02/2026'), null);
  assert.equal(normaliseTime(0.4375), '10:30');
  assert.equal(normaliseTime('9:05'), '09:05');
  const res = validateImportRows([{ ...goodRow, Start: '18:00', End: '06:00' }], ctx());
  assert.equal(res.rows[0].data.endAt, localToUtcIso('2026-10-06', '06:00'));
  assert.ok(res.rows[0].warnings.length);
});

test('import: sanitises text, undoes the export formula guard, enforces limits', () => {
  const res = validateImportRows([{ ...goodRow, Notes: "'=HYPERLINK(\"x\")\u0007", Title: 'A\u0000B' }], ctx());
  assert.equal(res.rows[0].data.notes, '=HYPERLINK("x")');
  assert.equal(res.rows[0].data.title, 'AB');
  const many = Array.from({ length: 501 }, () => goodRow);
  assert.match(validateImportRows(many, ctx()).errors[0].message, /Too many rows/);
  assert.match(validateImportRows([], ctx()).errors[0].message, /no data rows/);
});

// ── Live-conflict response shape: no leakage ────────────────────────────────
test('public conflict projection exposes only a boolean and count', () => {
  const { buildConflictResponse } = require('./conflictResponse');
  const overlapping = [{ id: 'x', title: 'SECRET-TITLE', contactEmail: 'secret@x.com', notes: 'SECRET-NOTES', status: 'pending', startAt: 'a', endAt: 'b' }];
  const pub = buildConflictResponse(overlapping, false);
  assert.deepEqual(Object.keys(pub).sort(), ['count', 'hasConflict']);
  assert.ok(!JSON.stringify(pub).includes('SECRET'));
  const adm = buildConflictResponse(overlapping, true);
  assert.equal(adm.conflicts[0].title, 'SECRET-TITLE');
});

test('masked projection still leaks nothing for pending events', () => {
  const out = projectPublicEvent({ title: 'SECRET', status: 'pending', contactEmail: 'secret@x.com', notes: 'SECRET', startAt: 'a', endAt: 'b', venueId: 'v', venueName: 'V' }, 'id1', null);
  assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.ok(!JSON.stringify(out).includes('secret@'));
});
