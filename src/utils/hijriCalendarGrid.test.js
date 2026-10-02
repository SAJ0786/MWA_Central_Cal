import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGregorianMonthGrid,
  buildHijriMonthGrid,
  gregorianCursorToHijri,
  hijriCursorToGregorian,
  shiftGregorianCursor,
  shiftHijriCursor,
  dateKeyFromParts
} from './hijriCalendarGrid.js';

test('Gregorian month grid pads to full weeks and marks in-month cells correctly', () => {
  const { cells, label } = buildGregorianMonthGrid(2026, 9, []); // October 2026 (31 days)
  assert.equal(cells.length % 7, 0);
  assert.ok(label.includes('October') && label.includes('2026'));
  const inMonth = cells.filter(c => c.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0].date.getDate(), 1);
  assert.equal(inMonth[inMonth.length - 1].date.getDate(), 31);
  // Every cell carries a resolved Hijri equivalent alongside the Gregorian date.
  assert.ok(inMonth.every(c => c.hijri && c.hijri.year > 0));
});

test('Hijri month grid is built from the Hijri calendar outward (not a relabeled Gregorian month)', () => {
  const { cells, label } = buildHijriMonthGrid(1448, 5, []); // Jumada al-Awwal 1448
  assert.equal(cells.length % 7, 0);
  assert.ok(label.includes('Jumada al-Awwal') && label.includes('1448'));
  const inMonth = cells.filter(c => c.inMonth);
  // A Hijri month is always 29 or 30 days — never a Gregorian-style 28–31.
  assert.ok(inMonth.length === 29 || inMonth.length === 30);
  // In-month days must be contiguous 1..monthLength with no gaps/duplicates.
  const days = inMonth.map(c => c.hijri.day).sort((a, b) => a - b);
  assert.deepEqual(days, Array.from({ length: inMonth.length }, (_, i) => i + 1));
});

test('a moon-sighting override changes the Hijri grid month length / start, not just labels', () => {
  const base = buildHijriMonthGrid(1448, 5, []);
  const overrides = [{ hYear: 1448, hMonth: 5, gDate: '2026-10-14' }];
  const adjusted = buildHijriMonthGrid(1448, 5, overrides);
  // The first in-month cell's Gregorian key shifts with the override.
  const firstBase = base.cells.find(c => c.inMonth).key;
  const firstAdjusted = adjusted.cells.find(c => c.inMonth).key;
  assert.notEqual(firstBase, firstAdjusted);
});

test('cursor conversion round-trips between Gregorian-primary and Hijri-primary', () => {
  const hCursor = gregorianCursorToHijri(2026, 9, []); // October 2026
  const gCursor = hijriCursorToGregorian(hCursor.hYear, hCursor.hMonth, []);
  // Converting back should land within the same or an adjacent Gregorian month
  // (Hijri months don't align to Gregorian month boundaries), but must be a
  // valid, close date rather than an arbitrary one.
  const diffMonths = Math.abs((gCursor.year - 2026) * 12 + (gCursor.month - 9));
  assert.ok(diffMonths <= 1);
});

test('shiftGregorianCursor and shiftHijriCursor move forward/back by whole months, wrapping years', () => {
  assert.deepEqual(shiftGregorianCursor({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftGregorianCursor({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  const next = shiftHijriCursor({ hYear: 1448, hMonth: 12 }, 1);
  assert.deepEqual(next, { hYear: 1449, hMonth: 1 });
  const prev = shiftHijriCursor({ hYear: 1448, hMonth: 1 }, -1);
  assert.deepEqual(prev, { hYear: 1447, hMonth: 12 });
});

test('dateKeyFromParts formats as zero-padded YYYY-MM-DD', () => {
  assert.equal(dateKeyFromParts(2026, 0, 5), '2026-01-05');
  assert.equal(dateKeyFromParts(2026, 11, 31), '2026-12-31');
});
