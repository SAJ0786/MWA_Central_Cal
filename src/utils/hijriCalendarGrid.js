// Pure, testable month-grid builder supporting two "primary" calendars.
//
// In Gregorian-primary mode the grid follows a normal Gregorian month
// (28–31 days); in Hijri-primary mode the grid follows a Hijri month
// (29 or 30 days, variable with the admin's moon-sighting overrides) and is
// built from the Hijri calendar outward rather than by relabeling a fixed
// Gregorian month. Every cell always carries both date forms so the UI can
// render both regardless of which one is primary. Weekday columns/labels are
// identical in both modes — only the month navigation unit and in-month
// day-numbering differ.
import {
  HIJRI_MONTHS,
  addHijriMonths,
  adjustedIslamicToGregorian,
  getHijriMonthLength,
  getHijriParts
} from '../services/hijriService.js';

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dateKeyFromParts(y, m, d) {
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function mondayFirstDow(date) {
  return (date.getDay() + 6) % 7;
}

/** Build a Gregorian-primary month grid for {year, month(0-based)}. */
export function buildGregorianMonthGrid(year, month, overrides = []) {
  const firstOfMonth = new Date(year, month, 1);
  const firstDow = mondayFirstDow(firstOfMonth);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, 1 - firstDow + i);
    const key = dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
    cells.push({
      date,
      key,
      hijri: getHijriParts(key, overrides),
      inMonth: date.getMonth() === month && date.getFullYear() === year
    });
  }

  return {
    cells,
    label: firstOfMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  };
}

/** Build a Hijri-primary month grid for Hijri {hYear, hMonth(1-based)}. */
export function buildHijriMonthGrid(hYear, hMonth, overrides = []) {
  const monthLength = getHijriMonthLength(hYear, hMonth, overrides);
  const start = adjustedIslamicToGregorian(hYear, hMonth, 1, overrides);
  const startDate = new Date(start.year, start.month - 1, start.day);
  const firstDow = mondayFirstDow(startDate);
  const totalCells = Math.ceil((firstDow + monthLength) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + (i - firstDow));
    const key = dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
    // Re-derive each cell's Hijri day on the fly (rather than tracking index
    // math across the month boundary) so variable 29/30-day lengths and
    // override-driven shifts are handled automatically and correctly.
    const hijri = getHijriParts(key, overrides);
    cells.push({
      date,
      key,
      hijri,
      inMonth: hijri.year === hYear && hijri.month === hMonth
    });
  }

  const monthName = HIJRI_MONTHS.find(m => m.value === hMonth)?.name || '';
  return {
    cells,
    label: `${monthName} ${hYear} AH`
  };
}

/** Convert a Gregorian-primary cursor {year, month} to its matching Hijri-primary cursor. */
export function gregorianCursorToHijri(year, month, overrides = []) {
  const parts = getHijriParts(dateKeyFromParts(year, month, 1), overrides);
  return { hYear: parts.year, hMonth: parts.month };
}

/** Convert a Hijri-primary cursor {hYear, hMonth} to its matching Gregorian-primary cursor. */
export function hijriCursorToGregorian(hYear, hMonth, overrides = []) {
  const g = adjustedIslamicToGregorian(hYear, hMonth, 1, overrides);
  return { year: g.year, month: g.month - 1 };
}

export function shiftGregorianCursor({ year, month }, delta) {
  const idx = year * 12 + month + delta;
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 };
}

export function shiftHijriCursor({ hYear, hMonth }, delta) {
  const next = addHijriMonths(hYear, hMonth, delta);
  return { hYear: next.year, hMonth: next.month };
}
