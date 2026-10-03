import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCell, bookingsToRows, EXPORT_HEADERS, templateRows, filterByDateRange, toDmy } from './excelUtils.js';

test('sanitizeCell prefixes formula starters only', () => {
  for (const s of ['=1+1', '+1', '-1', '@x', '\tx']) assert.equal(sanitizeCell(s), `'${s}`);
  assert.equal(sanitizeCell('Hello'), 'Hello');
  assert.equal(sanitizeCell(5), 5);
  assert.equal(sanitizeCell(null), '');
});

const fmt = { dateKey: i => i.slice(0, 10), timeKey: i => i.slice(11, 16), hijriParts: () => ({ day: 23, month: 4, year: 1448 }) };

test('export rows align with headers, guard formulas and include recurrence info', () => {
  const rows = bookingsToRows([{
    id: 'a', title: '=cmd()', departmentName: 'Youth', venueName: 'Hall', startAt: '2026-10-05T10:30:00Z', endAt: '2026-10-05T15:00:00Z',
    status: 'confirmed', visibility: 'public', contactName: '+x', notes: '@n', hasConflict: true,
    seriesId: 's1', seriesIndex: 2, seriesCount: 5, recurrence: { frequency: 'week', repeatEvery: 2, basis: 'gregorian', endMode: 'count', count: 5 }
  }], fmt);
  assert.equal(rows[0].length, EXPORT_HEADERS.length);
  assert.equal(rows[0][1], "'=cmd()");
  assert.equal(rows[0][12], "'+x");
  assert.equal(rows[0][15], "'@n");
  assert.equal(rows[0][16], 'yes');
  assert.match(rows[0][18], /Every 2 weeks.*#2\/5/);
});

test('template has headers plus example rows; range filter is inclusive', () => {
  assert.equal(templateRows()[0][0], 'Id');
  const ev = [{ startAt: '2024-01-01T00:00:00Z' }, { startAt: '2026-01-01T00:00:00Z' }];
  assert.equal(filterByDateRange(ev, '2024-01-01', '2024-12-31', fmt.dateKey).length, 1);
  assert.equal(filterByDateRange(ev, '', '', fmt.dateKey).length, 2);
});

test('export dates are DD/MM/YYYY; Hijri-anchored rows export their Hijri source date as the Date', () => {
  const g = bookingsToRows([{ id: 'g', title: 'G', startAt: '2026-10-05T10:30:00Z', endAt: '2026-10-05T15:00:00Z', status: 'confirmed' }], fmt)[0];
  assert.deepEqual([g[4], g[5], g[8], g[9]], ['Gregorian', '05/10/2026', '05/10/2026', '23/04/1448']);
  const h = bookingsToRows([{ id: 'h', title: 'H', dateBasis: 'hijri', hijriDate: { day: 3, month: 5, year: 1448 }, startAt: '2026-10-05T10:30:00Z', endAt: '2026-10-05T15:00:00Z', status: 'confirmed' }], fmt)[0];
  assert.deepEqual([h[4], h[5], h[8]], ['Hijri', '03/05/1448', '05/10/2026']);
  assert.equal(toDmy('2026-01-09'), '09/01/2026');
});

test('template shows dd/mm/yyyy, a Hijri example and matching column counts', () => {
  const rows = templateRows();
  assert.equal(rows[0][4], 'Date Basis');
  assert.ok(rows.every(r => r.length === rows[0].length));
  assert.deepEqual([rows[1][4], rows[1][5], rows[2][4], rows[2][5]], ['Gregorian', '05/10/2026', 'Hijri', '23/04/1448']);
});