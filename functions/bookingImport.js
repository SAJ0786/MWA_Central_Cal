// Pure validation/normalisation for the admin Excel (.xlsx) booking import.
// The workbook is parsed in the (admin-only) browser into plain row objects; this module
// validates them server-side so the rules cannot be bypassed by a modified client.
const { localToUtcIso } = require('./dateUtils');

const MAX_IMPORT_ROWS = 500;
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
const VISIBILITIES = ['public', 'private'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADER_ALIASES = {
  id: 'id', title: 'title', department: 'department', venue: 'venue',
  date: 'date', start: 'start', starttime: 'start', end: 'end', endtime: 'end',
  status: 'status', visibility: 'visibility',
  contactname: 'contactName', contactemail: 'contactEmail', contactphone: 'contactPhone',
  notes: 'notes'
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Remove control characters; drop the apostrophe the exporter adds to neutralise formulas. */
function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  let s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s.slice(0, max);
}

function normaliseHeaders(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const key = HEADER_ALIASES[String(k).toLowerCase().replace(/[\s_\-]/g, '')];
    if (key) out[key] = v;
  }
  return out;
}

/** 'YYYY-MM-DD' | 'DD/MM/YYYY' | Excel serial number -> 'YYYY-MM-DD' (or null). */
function normaliseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  let y; let m; let d;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const t = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  } else {
    const s = String(value).trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (match) { y = +match[1]; m = +match[2]; d = +match[3]; } else {
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!match) return null;
      d = +match[1]; m = +match[2]; y = +match[3];
    }
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 'HH:MM' | 'H:MM' | Excel day-fraction number -> 'HH:MM' (or null). */
function normaliseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const frac = value - Math.floor(value);
    const mins = Math.round(frac * 1440) % 1440;
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
  }
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  if (!match) return null;
  const h = +match[1]; const mi = +match[2];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

function nextDayKey(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/**
 * @param {object[]} rawRows rows parsed from the sheet (header -> cell value)
 * @param {{departments:{id,name}[], venues:{id,name}[], existingById:Object, existingKeys:Set<string>}} ctx
 * @returns {{rows:object[], errors:{row:number,message:string}[], counts:object}}
 */
function validateImportRows(rawRows, ctx) {
  const errors = [];
  const rows = [];
  if (!Array.isArray(rawRows) || !rawRows.length) {
    return { rows, errors: [{ row: 0, message: 'The file has no data rows.' }], counts: { create: 0, update: 0, skip: 0, errors: 1 } };
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    return { rows, errors: [{ row: 0, message: `Too many rows (${rawRows.length}). The limit is ${MAX_IMPORT_ROWS} per import.` }], counts: { create: 0, update: 0, skip: 0, errors: 1 } };
  }
  const deptByName = new Map(ctx.departments.map(d => [d.name.trim().toLowerCase(), d]));
  const venueByName = new Map(ctx.venues.map(v => [v.name.trim().toLowerCase(), v]));
  const seenKeys = new Set();
  const seenIds = new Set();
  const counts = { create: 0, update: 0, skip: 0, errors: 0 };

  rawRows.forEach((raw, i) => {
    const rowNumber = i + 2; // sheet row (header is row 1)
    const r = normaliseHeaders(raw);
    const problems = [];
    const warnings = [];

    const title = cleanText(r.title, 200);
    if (!title) problems.push('Title is required.');

    const deptName = cleanText(r.department, 200);
    const dept = deptByName.get(deptName.toLowerCase());
    if (!deptName) problems.push('Department is required.');
    else if (!dept) problems.push(`Unknown department "${deptName}" (add it under Admin > Departments first).`);

    const venueName = cleanText(r.venue, 200);
    const venue = venueByName.get(venueName.toLowerCase());
    if (!venueName) problems.push('Venue is required.');
    else if (!venue) problems.push(`Unknown venue "${venueName}" (add it under Admin > Venues first).`);

    const date = normaliseDate(r.date);
    if (!date) problems.push('Date must be YYYY-MM-DD or DD/MM/YYYY.');
    const start = normaliseTime(r.start);
    const end = normaliseTime(r.end);
    if (!start) problems.push('Start must be a time like 09:00.');
    if (!end) problems.push('End must be a time like 17:00.');

    const statusRaw = cleanText(r.status, 20).toLowerCase();
    const status = statusRaw || 'confirmed';
    if (!STATUSES.includes(status)) problems.push(`Status must be one of ${STATUSES.join(', ')}.`);
    const visRaw = cleanText(r.visibility, 20).toLowerCase();
    const visibility = visRaw || 'public';
    if (!VISIBILITIES.includes(visibility)) problems.push('Visibility must be public or private.');

    const contactEmail = cleanText(r.contactEmail, 200);
    if (contactEmail && !EMAIL_RE.test(contactEmail)) problems.push('Contact email is not a valid email address.');

    let startAt = null; let endAt = null;
    if (date && start && end) {
      startAt = localToUtcIso(date, start);
      let endDate = date;
      if (end <= start) { endDate = nextDayKey(date); warnings.push('End is not after start: treated as ending the next day (overnight).'); }
      endAt = localToUtcIso(endDate, end);
    }

    const id = cleanText(r.id, 40);
    if (id && !/^[A-Za-z0-9_-]{1,40}$/.test(id)) problems.push('Id may only contain letters, numbers, - and _.');
    if (id && seenIds.has(id)) problems.push(`Id "${id}" appears more than once in the file.`);

    if (problems.length) {
      errors.push({ row: rowNumber, message: problems.join(' ') });
      counts.errors += 1;
      return;
    }

    let action = 'create';
    if (id) seenIds.add(id);
    if (id && ctx.existingById[id]) {
      action = 'update';
    } else {
      if (id) warnings.push(`Id "${id}" was not found; a new booking will be created.`);
      const key = `${venue.id}|${startAt}|${endAt}|${title.toLowerCase()}`;
      if (ctx.existingKeys.has(key) || seenKeys.has(key)) {
        action = 'skip';
        warnings.push('Duplicate of an existing booking (same title, venue and time): skipped.');
      }
      seenKeys.add(key);
    }
    counts[action] += 1;
    rows.push({
      row: rowNumber, action, warnings,
      id: action === 'update' ? id : null,
      data: {
        title, departmentId: dept.id, departmentName: dept.name,
        venueId: venue.id, venueName: venue.name,
        startAt, endAt, status, visibility,
        contactName: cleanText(r.contactName, 200),
        contactEmail,
        contactPhone: cleanText(r.contactPhone, 50),
        notes: cleanText(r.notes, 2000)
      }
    });
  });

  return { rows, errors, counts };
}

module.exports = {
  validateImportRows, normaliseDate, normaliseTime, cleanText, MAX_IMPORT_ROWS
};
