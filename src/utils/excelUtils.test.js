import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCell, bookingsToRows, EXPORT_HEADERS, templateRows, filterByDateRange } from './excelUtils.js';

test('sanitizeCell prefixes formula starters only', () => {
  for (const s of ['=1+1', '+1', '-1', '@x', '\tx']) assert.equal(sanitizeCell(s), `'${s}`);
  assert.equal(sanitizeCell('Hello'), 'Hello');
  assert.equal(sanitizeCell(5), 5);
  assert.equal(sanitizeCell(null), '');
});

const fmt = { dateKey: i => i.slice(0, 10), timeKey: i => i.slice(11, 16), hijri: () => '1 Rabi' };

test('export rows align with headers, guard formulas and include recurrence info', () => {
  const rows = bookingsToRows([{
    id: 'a', title: '=cmd()', departmentName: 'Youth', venueName: 'Hall', startAt: '2026-10-05T10:30:00Z', endAt: '2026-10-05T15:00:00Z',
    status: 'confirmed', visibility: 'public', contactName: '+x', notes: '@n', hasConflict: true,
    seriesId: 's1', seriesIndex: 2, seriesCount: 5, recurrence: { frequency: 'week', repeatEvery: 2, basis: 'gregorian', endMode: 'count', count: 5 }
  }], fmt);
  assert.equal(rows[0].length, EXPORT_HEADERS.length);
  assert.equal(rows[0][1], "'=cmd()");
  assert.equal(rows[0][10], "'+x");
  assert.equal(rows[0][13], "'@n");
  assert.equal(rows[0][14], 'yes');
  assert.match(rows[0][16], /Every 2 weeks.*#2\/5/);
});

test('template has headers plus example rows; range filter is inclusive', () => {
  assert.equal(templateRows()[0][0], 'Id');
  const ev = [{ startAt: '2024-01-01T00:00:00Z' }, { startAt: '2026-01-01T00:00:00Z' }];
  assert.equal(filterByDateRange(ev, '2024-01-01', '2024-12-31', fmt.dateKey).length, 1);
  assert.equal(filterByDateRange(ev, '', '', fmt.dateKey).length, 2);
});
