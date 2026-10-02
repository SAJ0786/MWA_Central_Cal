// Client-side iCal (.ics) and CSV export helpers for the bookings list.
// (A public, always-current .ics feed is also served server-side at
// /ical — see functions/icalFeed.js — for subscribing in Google/Outlook.)

function pad(n) { return String(n).padStart(2, '0'); }

function toIcsDate(isoString) {
  const d = new Date(isoString);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
}

function escapeIcs(text = '') {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcs(events, { calendarName = 'Community Hub Calendar' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Community Hub Calendar//EN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    'CALSCALE:GREGORIAN'
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@community-hub-calendar`,
      `DTSTAMP:${toIcsDate(e.updatedAt || e.createdAt || e.startAt)}`,
      `DTSTART:${toIcsDate(e.startAt)}`,
      `DTEND:${toIcsDate(e.endAt)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      `LOCATION:${escapeIcs(e.venueName || e.venueId || '')}`,
      `DESCRIPTION:${escapeIcs([e.departmentName, e.status].filter(Boolean).join(' · '))}`,
      `STATUS:${e.status === 'confirmed' ? 'CONFIRMED' : e.status === 'cancelled' ? 'CANCELLED' : 'TENTATIVE'}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(events, filename = 'bookings.ics') {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  triggerDownload(blob, filename);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(events) {
  const headers = ['title', 'department', 'venue', 'start', 'end', 'status', 'visibility', 'hasConflict', 'contactName', 'contactEmail'];
  const rows = events.map(e => [
    e.title, e.departmentName || e.departmentId, e.venueName || e.venueId,
    e.startAt, e.endAt, e.status, e.visibility, e.hasConflict ? 'yes' : 'no',
    e.contactName || '', e.contactEmail || ''
  ]);
  return [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
}

export function downloadCsv(events, filename = 'bookings.csv') {
  const blob = new Blob([buildCsv(events)], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
