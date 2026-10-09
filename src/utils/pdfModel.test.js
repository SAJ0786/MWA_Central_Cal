import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfModel, ordinalSuffix, to12h } from '../services/pdfModel.js';

const ev = (id, startAt, endAt, extra = {}) => ({ id, title: id, startAt, endAt, status: 'confirmed', venueName: 'Main Hall', departmentName: 'Youth', ...extra });

test('ordinals and 12h times', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(ordinalSuffix), ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'th']);
  assert.equal(to12h('19:00'), '7:00 pm');
  assert.equal(to12h('00:30'), '12:30 am');
  assert.equal(to12h('12:00'), '12:00 pm');
});

test('Gregorian month: only that month, sorted, masked dropped', () => {
  const m = buildPdfModel({
    basis: 'gregorian', year: 2026, month: 8,
    events: [
      ev('b', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'),
      ev('a', '2026-09-13T09:00:00Z', '2026-09-13T10:00:00Z'),
      ev('out', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
      ev('priv', '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z', { masked: true })
    ]
  });
  assert.deepEqual(m.titleWords, ['SEPTEMBER']);
  assert.deepEqual(m.rows.map(r => r.events[0].title), ['a', 'b']);
  assert.equal(m.eventCount, 2);
  assert.equal(m.rows[0].greg.dow, 'Sun');
  assert.equal(m.rows[0].greg.day, 13);
  assert.match(m.pill, /^2026 \/ 14\d\d$/);
  assert.ok(m.arabic);
});

test('Hijri month covers its own Gregorian span', () => {
  const m = buildPdfModel({
    basis: 'hijri', hYear: 1448, hMonth: 4,
    events: [ev('x', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'), ev('y', '2026-12-30T09:00:00Z', '2026-12-30T11:00:00Z')]
  });
  assert.deepEqual(m.titleWords, ['RABI', 'SANI']);
  assert.equal(m.pill.startsWith('1448 / 2026'), true);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].hijri.month, 'Rabi Sani');
  assert.match(m.footerLabel, /Rabi Sani - 1448\/2026/);
});
