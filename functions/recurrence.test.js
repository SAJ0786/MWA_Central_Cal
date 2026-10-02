const test = require('node:test');
const assert = require('node:assert/strict');
const { generateOccurrences, RecurrenceError } = require('./recurrence');
const { toOrgTimeParts } = require('./dateUtils');
const { adjustedGregorianToIslamic } = require('./hijriService');
const { selectSeriesTargets, retimeOccurrence } = require('./seriesScope');

const base = { basis: 'gregorian', startTime: '12:00', endTime: '16:00', repeatEvery: 1, endMode: 'count' };

test('weekly series keeps 12:00-16:00 Sydney wall-clock across the Oct 2026 DST start', () => {
  // 2026-09-27 is AEST; DST starts Sun 4 Oct 2026.
  const occ = generateOccurrences({ ...base, startDate: '2026-09-27', frequency: 'week', count: 4 });
  assert.deepEqual(occ.map(o => o.dateKey), ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
  for (const o of occ) {
    assert.equal(toOrgTimeParts(o.startAt).timeStr, '12:00');
    assert.equal(toOrgTimeParts(o.endAt).timeStr, '16:00');
    assert.equal(toOrgTimeParts(o.startAt).dateStr, o.dateKey);
  }
  assert.equal(occ[0].startAt, '2026-09-27T02:00:00.000Z'); // UTC+10
  assert.equal(occ[1].startAt, '2026-10-04T01:00:00.000Z'); // UTC+11
});

test('monthly series clamps to month end without drifting', () => {
  const occ = generateOccurrences({ ...base, startDate: '2026-01-31', frequency: 'month', count: 4 });
  assert.deepEqual(occ.map(o => o.dateKey), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('end by date is inclusive; repeatEvery applies', () => {
  const occ = generateOccurrences({ ...base, startDate: '2026-06-01', frequency: 'day', repeatEvery: 3, endMode: 'date', endDate: '2026-06-10' });
  assert.deepEqual(occ.map(o => o.dateKey), ['2026-06-01', '2026-06-04', '2026-06-07', '2026-06-10']);
});

test('caps and validation', () => {
  const bad = (rule, re) => assert.throws(() => generateOccurrences({ ...base, startDate: '2026-06-01', ...rule }), re);
  bad({ frequency: 'year', count: 6 }, RecurrenceError);
  bad({ frequency: 'week', count: 60 }, /one year/);
  bad({ frequency: 'day', count: 371 }, /maximum/);
  bad({ frequency: 'day', endMode: 'date', endDate: '2028-01-01' }, /one year/);
  bad({ frequency: 'day', endMode: 'date', endDate: '2026-05-01' }, /before/);
  bad({ frequency: 'fortnight', count: 2 }, /frequency/);
  bad({ frequency: 'day', repeatEvery: 0, count: 2 }, /between 1 and 100/);
  bad({ frequency: 'day', count: 2, endTime: '11:00' }, /after start/);
  assert.equal(generateOccurrences({ ...base, startDate: '2026-06-01', frequency: 'year', count: 5 }).length, 5);
  assert.equal(generateOccurrences({ ...base, startDate: '2026-06-01', frequency: 'day', count: 366 }).length, 366);
});

test('hijri monthly series: each occurrence anchored to the same Hijri day, round-trips', () => {
  const rule = { ...base, basis: 'hijri', hijriStart: { day: 10, month: 1, year: 1448 }, frequency: 'month', count: 6 };
  const occ = generateOccurrences(rule, []);
  assert.equal(occ.length, 6);
  occ.forEach((o, i) => {
    assert.equal(o.hijriDate.day, 10);
    assert.equal(o.hijriDate.month, i + 1);
    const [y, m, d] = o.dateKey.split('-').map(Number);
    const h = adjustedGregorianToIslamic(y, m, d, []);
    assert.deepEqual({ day: h.day, month: h.month, year: h.year }, o.hijriDate);
  });
});

test('hijri series follows a moon-sighting override but keeps the Hijri anchors', () => {
  const rule = { ...base, basis: 'hijri', hijriStart: { day: 5, month: 3, year: 1448 }, frequency: 'month', count: 3 };
  const plain = generateOccurrences(rule, []);
  const m3 = plain[0].dateKey;
  const shifted = (() => { const [y, m, d] = m3.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 4 + 1)).toISOString().slice(0, 10); })();
  const adjusted = generateOccurrences(rule, [{ hYear: 1448, hMonth: 3, gDate: shifted }]);
  assert.notEqual(adjusted[0].dateKey, plain[0].dateKey);
  assert.deepEqual(adjusted.map(o => o.hijriDate.day), [5, 5, 5]);
});

test('hijri weekly series derives each occurrence Hijri anchor from its Gregorian date', () => {
  const occ = generateOccurrences({ ...base, basis: 'hijri', hijriStart: { day: 1, month: 9, year: 1448 }, frequency: 'week', count: 3 }, []);
  const diffDays = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  assert.equal(diffDays(occ[0].dateKey, occ[1].dateKey), 7);
  assert.ok(occ.every(o => o.hijriDate && o.hijriDate.year));
});

test('series scope selection and retiming', () => {
  const docs = ['2026-09-27', '2026-10-04', '2026-10-11'].map((d, i) => ({ id: `e${i}`, seriesId: 's1', startAt: `${d}T01:00:00.000Z` }))
    .concat([{ id: 'x', seriesId: 's2', startAt: '2026-10-11T01:00:00.000Z' }]);
  assert.deepEqual(selectSeriesTargets(docs, docs[1], 'single').map(d => d.id), ['e1']);
  assert.deepEqual(selectSeriesTargets(docs, docs[1], 'future').map(d => d.id), ['e1', 'e2']);
  assert.deepEqual(selectSeriesTargets(docs, docs[1], 'all').map(d => d.id), ['e0', 'e1', 'e2']);
  assert.deepEqual(selectSeriesTargets(docs, docs[1], 'bogus').map(d => d.id), ['e1']);
  const r = retimeOccurrence({ startAt: '2026-10-04T01:00:00.000Z' }, '09:30', '11:00');
  assert.equal(toOrgTimeParts(r.startAt).timeStr, '09:30');
  assert.equal(toOrgTimeParts(r.startAt).dateStr, '2026-10-04');
});
