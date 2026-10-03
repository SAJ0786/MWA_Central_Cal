// Hijri Calendar Service — ported unchanged from the Community Events App
// (src/services/hijriService.js) so both products always agree on Hijri
// dates. Moon-sighting overrides + tabular 29/30 fallback.
//
// Each override anchors day 1 of a Hijri month to an exact Gregorian date.
// Months without their own override follow the same tabular 29/30-day
// rhythm, shifted by the latest saved community moon-sighting correction.
//
// Source of truth: SAJ0786/community-events-app, src/services/hijriService.js
// Keep this file in sync if that module changes.

export const HIJRI_MONTHS = [
  { value: 1, name: 'Muharram' },
  { value: 2, name: 'Safar' },
  { value: 3, name: 'Rabi al-Awwal' },
  { value: 4, name: 'Rabi al-Thani' },
  { value: 5, name: 'Jumada al-Awwal' },
  { value: 6, name: 'Jumada al-Thani' },
  { value: 7, name: 'Rajab' },
  { value: 8, name: "Sha'ban" },
  { value: 9, name: 'Ramadan' },
  { value: 10, name: 'Shawwal' },
  { value: 11, name: "Dhu al-Qi'dah" },
  { value: 12, name: 'Dhu al-Hijjah' }
];

function gregorianToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10)
  };
}

function islamicToJdnAstro(year, month, day) {
  return day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354
    + Math.floor((3 + 11 * year) / 30) + 1948439;
}

function jdnToIslamicAstro(jdn) {
  const year = Math.floor((30 * (jdn - 1948439) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jdn - 29 - islamicToJdnAstro(year, 1, 1)) / 29.5) + 1);
  const day = jdn - islamicToJdnAstro(year, month, 1) + 1;
  return { year, month, day };
}

function monthIndex(year, month) {
  return Number(year) * 12 + (Number(month) - 1);
}

function fromMonthIndex(idx) {
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 };
}

export function addHijriMonths(year, month, delta) {
  return fromMonthIndex(monthIndex(year, month) + delta);
}

function compareHijri(a, b) {
  return a.year !== b.year ? a.year - b.year
    : a.month !== b.month ? a.month - b.month
      : (a.day || 1) - (b.day || 1);
}

function sortOverrides(arr) {
  const sorted = [...(arr || [])]
    .map(o => ({
      hYear: Number(o?.hYear),
      hMonth: Number(o?.hMonth),
      gDate: String(o?.gDate || '')
    }))
    .filter(o => o.hYear && o.hMonth && o.gDate)
    .sort((a, b) => compareHijri(
      { year: a.hYear, month: a.hMonth },
      { year: b.hYear, month: b.hMonth }
    ));

  const cleaned = [];
  for (const override of sorted) {
    const [y, m, d] = override.gDate.split('-').map(Number);
    if (!y || !m || !d) continue;
    const jdn = gregorianToJdn(y, m, d);
    const prev = cleaned[cleaned.length - 1];
    if (prev) {
      const [py, pm, pd] = prev.gDate.split('-').map(Number);
      const monthDiff = monthIndex(override.hYear, override.hMonth) - monthIndex(prev.hYear, prev.hMonth);
      const minDays = Math.max(1, monthDiff) * 29;
      const maxDays = Math.max(1, monthDiff) * 30;
      const dayDiff = jdn - gregorianToJdn(py, pm, pd);
      if (monthDiff <= 0 || dayDiff < minDays || dayDiff > maxDays) continue;
    }
    cleaned.push(override);
  }
  return cleaned;
}

function deltaForMonth(hYear, hMonth, overrides = []) {
  let delta = 0;
  for (const ov of sortOverrides(overrides)) {
    const cmp = compareHijri(
      { year: hYear, month: hMonth },
      { year: ov.hYear, month: ov.hMonth }
    );
    if (cmp >= 0) {
      const [y, m, d] = ov.gDate.split('-').map(Number);
      delta = gregorianToJdn(y, m, d) - islamicToJdnAstro(ov.hYear, ov.hMonth, 1);
    }
  }
  return delta;
}

function adjustedIslamicToJdn(hYear, hMonth, hDay, overrides = []) {
  return islamicToJdnAstro(hYear, hMonth, hDay) + deltaForMonth(hYear, hMonth, overrides);
}

function monthStartJdn(hYear, hMonth, overrides = []) {
  return adjustedIslamicToJdn(Number(hYear), Number(hMonth), 1, overrides);
}

export function getHijriMonthLength(hYear, hMonth, overrides = []) {
  const next = addHijriMonths(Number(hYear), Number(hMonth), 1);
  return monthStartJdn(next.year, next.month, overrides) -
    monthStartJdn(Number(hYear), Number(hMonth), overrides);
}

/** Convert Hijri (y,m,d) to Gregorian {year,month,day}. */
export function adjustedIslamicToGregorian(hYear, hMonth, hDay, overrides = []) {
  const startJdn = monthStartJdn(hYear, hMonth, overrides);
  return jdnToGregorian(startJdn + (Number(hDay) - 1));
}

/** Convert Gregorian (y,m,d) to Hijri {year,month,day}. */
export function adjustedGregorianToIslamic(gYear, gMonth, gDay, overrides = []) {
  try {
    if (!gYear || !gMonth || !gDay) return { year: 0, month: 0, day: 0 };
    const safeOverrides = sortOverrides(overrides);
    const target = gregorianToJdn(Number(gYear), Number(gMonth), Number(gDay));
    const approx = jdnToIslamicAstro(target);

    for (let i = -14; i <= 14; i++) {
      const cand = addHijriMonths(approx.year, approx.month, i);
      const start = monthStartJdn(cand.year, cand.month, safeOverrides);
      const next = addHijriMonths(cand.year, cand.month, 1);
      const nextStart = monthStartJdn(next.year, next.month, safeOverrides);
      if (target >= start && target < nextStart) {
        return { year: cand.year, month: cand.month, day: target - start + 1 };
      }
    }

    return approx;
  } catch {
    return { year: 0, month: 0, day: 0 };
  }
}

/** Hijri to "YYYY-MM-DD". */
export function hijriToGregorian(hDay, hMonth, hYear, overrides = []) {
  try {
    if (!hDay || !hMonth || !hYear) return null;
    const g = adjustedIslamicToGregorian(hYear, hMonth, hDay, overrides);
    if (!g || !g.year) return null;
    return `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/** Gregorian "YYYY-MM-DD" to display string "5 Muharram 1448 AH". */
export function getHijriDisplay(gregorianDate, overrides = []) {
  try {
    if (!gregorianDate || typeof gregorianDate !== 'string') return '';
    const parts = gregorianDate.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return '';
    const [y, m, d] = parts;
    const h = adjustedGregorianToIslamic(y, m, d, overrides);
    if (!h || !h.year || !h.month || !h.day) return '';
    const monthName = HIJRI_MONTHS.find(x => x.value === h.month)?.name || '';
    return `${h.day} ${monthName} ${h.year} AH`;
  } catch {
    return '';
  }
}

/** Gregorian date to Hijri {year,month,day}. */
export function getHijriParts(gregorianDate, overrides = []) {
  try {
    const [y, m, d] = (typeof gregorianDate === 'string'
      ? gregorianDate : gregorianDate.toISOString().slice(0, 10)
    ).split('-').map(Number);
    return adjustedGregorianToIslamic(y, m, d, overrides);
  } catch {
    return { year: 0, month: 0, day: 0 };
  }
}

/** Build display string from numeric components. */
export function hijriDisplayFromParts(hDay, hMonth, hYear) {
  if (!hDay || !hMonth || !hYear) return '';
  const monthName = HIJRI_MONTHS.find(m => m.value === Number(hMonth))?.name || '';
  return `${hDay} ${monthName} ${hYear} AH`;
}

/** Today's Hijri {year,month,day} using the Australia/Sydney civil date and the active adjustment. */
export function getTodayHijriParts(overrides = [], now = new Date()) {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return getHijriParts(key, overrides);
}

/** Current Hijri year (Sydney date, with adjustment). */
export function getCurrentHijriYear(overrides = []) {
  return getTodayHijriParts(overrides).year;
}