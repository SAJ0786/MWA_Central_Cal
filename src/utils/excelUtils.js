// Pure helpers for the admin Excel (.xlsx) import/export. No imports so they are testable in Node.
// Header names match functions/bookingImport.js aliases (round-trip safe).

export const EXPORT_HEADERS = [
  'Id', 'Title', 'Department', 'Venue', 'Date', 'Start', 'End', 'Hijri Date', 'Status', 'Visibility',
  'Contact Name', 'Contact Email', 'Contact Phone', 'Notes', 'Overlap', 'Series Id', 'Recurrence'
];

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

/** Neutralise spreadsheet formula injection: text starting with = + - @ (or tab/CR) gets a leading apostrophe. */
export function sanitizeCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function recurrenceSummary(e) {
  const r = e.recurrence;
  if (!e.seriesId) return '';
  if (!r) return `Series ${e.seriesIndex || ''}/${e.seriesCount || ''}`.trim();
  const unit = { day: 'day', week: 'week', month: 'month' }[r.frequency] || r.frequency;
  const n = Number(r.repeatEvery) > 1 ? `${r.repeatEvery} ${unit}s` : unit;
  const end = r.endMode === 'count' ? `${r.count} times` : r.endMode === 'date' ? `until ${r.endDate}` : '';
  return `Every ${n} (${r.basis}) ${end} #${e.seriesIndex || '?'}/${e.seriesCount || '?'}`.replace(/\s+/g, ' ').trim();
}

/** fmt = { dateKey(iso), timeKey(iso), hijri(iso) } — injected so this stays framework/host-tz free. */
export function bookingsToRows(events, fmt) {
  return events.map(e => [
    e.id, e.title, e.departmentName || '', e.venueName || '',
    fmt.dateKey(e.startAt), fmt.timeKey(e.startAt), fmt.timeKey(e.endAt), fmt.hijri(e.startAt),
    e.status, e.visibility || 'private',
    e.contactName || '', e.contactEmail || '', e.contactPhone || '', e.notes || '',
    e.hasConflict ? 'yes' : '', e.seriesId || '', recurrenceSummary(e)
  ].map(sanitizeCell));
}

export function templateRows() {
  return [
    EXPORT_HEADERS.slice(0, 14),
    ['', 'Example event', 'Youth', 'Main Hall', '2026-10-05', '10:30', '15:00', '', 'confirmed', 'public', 'Jane Citizen', 'jane@example.com', '0400 000 000', 'Optional notes'],
    ['', 'Overnight example', 'Youth', 'Main Hall', '2026-10-10', '18:00', '06:00', '', 'confirmed', 'public', '', '', '', 'End earlier than start = ends next day']
  ];
}

export function filterByDateRange(events, fromKey, toKey, dateKey) {
  return events.filter(e => {
    const k = dateKey(e.startAt);
    return (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
  });
}
