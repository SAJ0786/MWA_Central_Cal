// Pure data model for the monthly PDF calendar (no DOM/canvas) so it can be unit tested.
import { HIJRI_MONTHS, getHijriParts } from './hijriService.js';
import { buildGregorianMonthGrid, buildHijriMonthGrid } from '../utils/hijriCalendarGrid.js';
// Same org-timezone conversions as utils/dateUtils.js (kept local so this module stays Node-testable).
const ORG_TZ = 'Australia/Sydney';
const dateKeyInOrgTz = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: ORG_TZ });
const timeKeyInOrgTz = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: ORG_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

// Short transliterations used on the printed calendar (the in-app names are longer).
export const PDF_HIJRI_NAMES = {
  1: { en: 'Muharram', ar: 'محرم' },
  2: { en: 'Safar', ar: 'صفر' },
  3: { en: 'Rabi Awwal', ar: 'ربيع الأول' },
  4: { en: 'Rabi Sani', ar: 'ربيع الثاني' },
  5: { en: 'Jumada Awwal', ar: 'جمادى الأولى' },
  6: { en: 'Jumada Sani', ar: 'جمادى الآخرة' },
  7: { en: 'Rajab', ar: 'رجب' },
  8: { en: 'Shaban', ar: 'شعبان' },
  9: { en: 'Ramadan', ar: 'رمضان' },
  10: { en: 'Shawwal', ar: 'شوال' },
  11: { en: 'Dhul Qadah', ar: 'ذو القعدة' },
  12: { en: 'Dhul Hijjah', ar: 'ذو الحجة' }
};

const DOW3 = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];
const G_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

export function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

const keyToDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

function hijriName(month) { return PDF_HIJRI_NAMES[month]?.en || HIJRI_MONTHS.find(m => m.value === month)?.name || ''; }

/**
 * @param {object} p
 * @param {Array}  p.events   events already filtered by the caller (masked/private-for-public ones are dropped here too)
 * @param {'gregorian'|'hijri'} p.basis
 * @param {number} [p.year] [p.month] Gregorian year and 0-based month (basis=gregorian)
 * @param {number} [p.hYear] [p.hMonth] Hijri year and 1-based month (basis=hijri)
 */
export function buildPdfModel({ events, basis, year, month, hYear, hMonth, overrides = [] }) {
  const grid = basis === 'hijri'
    ? buildHijriMonthGrid(hYear, hMonth, overrides)
    : buildGregorianMonthGrid(year, month, overrides);
  const days = grid.cells.filter(c => c.inMonth);
  const keys = new Set(days.map(c => c.key));

  // Dominant Hijri month/year (Gregorian basis) and the Hijri span it covers.
  const tally = new Map();
  for (const c of days) {
    if (!c.hijri.year) continue;
    const k = `${c.hijri.year}-${c.hijri.month}`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const dominant = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('-').map(Number) || [hYear, hMonth];
  const first = days[0], last = days[days.length - 1];

  let titleWords, pill, tagline, footerLabel, arabic;
  if (basis === 'hijri') {
    const nm = hijriName(hMonth);
    titleWords = nm.toUpperCase().split(' ');
    arabic = PDF_HIJRI_NAMES[hMonth]?.ar || '';
    const gy = first.date.getFullYear();
    pill = `${hYear} / ${gy}`;
    const a = `${G_MONTHS[first.date.getMonth()].slice(0, 3)} ${gy}`;
    const b = `${G_MONTHS[last.date.getMonth()].slice(0, 3)} ${last.date.getFullYear()}`;
    tagline = (a === b ? a : `${a} – ${b}`).toUpperCase();
    footerLabel = `${nm} - ${hYear}/${gy}`;
  } else {
    titleWords = [G_MONTHS[month].toUpperCase()];
    arabic = PDF_HIJRI_NAMES[dominant[1]]?.ar || '';
    pill = `${year} / ${dominant[0]}`;
    const a = first.hijri.year ? `${hijriName(first.hijri.month)} ${first.hijri.year}` : '';
    const b = last.hijri.year ? `${hijriName(last.hijri.month)} ${last.hijri.year}` : '';
    tagline = (a === b ? `${a} AH` : `${a} – ${b} AH`).toUpperCase();
    footerLabel = `${G_MONTHS[month]} - ${year}/${dominant[0]}`;
  }

  const byKey = new Map();
  for (const e of events) {
    if (e.masked) continue;
    const key = dateKeyInOrgTz(e.startAt);
    if (!keys.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const rows = [...byKey.keys()].sort().map(key => {
    const d = keyToDate(key);
    const h = getHijriParts(key, overrides);
    const list = byKey.get(key).sort((a, b) => a.startAt.localeCompare(b.startAt));
    return {
      key,
      hijri: h.year ? { day: h.day, suffix: ordinalSuffix(h.day), month: hijriName(h.month) } : null,
      greg: { dow: DOW3[d.getDay()], day: d.getDate(), suffix: ordinalSuffix(d.getDate()), month: G_MONTHS[d.getMonth()].slice(0, 3) },
      events: list.map(e => {
        const venue = e.venueName || '';
        return {
          title: e.title || 'Untitled',
          detail: `[${to12h(timeKeyInOrgTz(e.startAt))} – ${to12h(timeKeyInOrgTz(e.endAt))}${venue ? ` · ${venue}` : ''}]`,
          department: e.departmentName || '',
          pending: e.status === 'pending'
        };
      })
    };
  });

  return { basis, titleWords, arabic, pill, tagline, footerLabel, rows, eventCount: rows.reduce((n, r) => n + r.events.length, 0) };
}

/** Month list helpers for the picker UI. */
export const GREGORIAN_MONTH_NAMES = G_MONTHS;
export const PDF_HIJRI_MONTH_OPTIONS = Object.entries(PDF_HIJRI_NAMES).map(([v, n]) => ({ value: Number(v), name: n.en }));
