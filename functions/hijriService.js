// Hijri Calendar Service — Cloud Functions (CommonJS) port of
// src/services/hijriService.js. Keep logic identical to the client module and
// to SAJ0786/community-events-app's src/services/hijriService.js so Hijri
// dates always agree across the public app, the admin UI and this backend.

const HIJRI_MONTHS = [
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

function addHijriMonths(year, month, delta) {
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
      hYear: Number(o && o.hYear),
      hMonth: Number(o && o.hMonth),
      gDate: String((o && o.gDate) || '')
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

function monthStartJdn(hYear, hMonth, overrides = []) {
  return islamicToJdnAstro(Number(hYear), Number(hMonth), 1) + deltaForMonth(hYear, hMonth, overrides);
}

function adjustedGregorianToIslamic(gYear, gMonth, gDay, overrides = []) {
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

function getHijriParts(gregorianDateStr, overrides = []) {
  const [y, m, d] = String(gregorianDateStr).split('-').map(Number);
  return adjustedGregorianToIslamic(y, m, d, overrides);
}

module.exports = { HIJRI_MONTHS, adjustedGregorianToIslamic, getHijriParts };
