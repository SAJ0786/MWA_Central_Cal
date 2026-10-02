// The ONLY shape in which booking data leaves the server for public callers
// (getPublicEvents callable, GET /v1/events without an admin token, the iCal feed).
//
// Rules:
//   confirmed + public   -> full public projection (title, department, venue, times)
//   confirmed + not public (private/missing) -> masked, title "Private"
//   pending              -> masked, title "Unconfirmed booking" (regardless of visibility)
//   rejected / cancelled / anything else -> null (never exposed)
//
// Masked items intentionally carry only: id, status, times, venue, hijri info, and the
// masked title. No contact details, notes, department, requested visibility or
// conflict data. Built as a whitelist (never by deleting fields from the raw doc) so
// any field added to events later is private by default.
const MASKED_TITLES = { private: 'Private', pending: 'Unconfirmed booking' };

function projectPublicEvent(d, id, hijri) {
  if (!d) return null;
  const base = {
    id,
    status: d.status,
    startAt: d.startAt,
    endAt: d.endAt,
    venueId: d.venueId,
    venueName: d.venueName || null,
    dateBasis: d.dateBasis || 'gregorian',
    hijri: hijri || null
  };
  if (d.status === 'confirmed' && d.visibility === 'public') {
    return {
      ...base,
      title: d.title,
      departmentId: d.departmentId,
      departmentName: d.departmentName || null,
      visibility: 'public',
      masked: false
    };
  }
  if (d.status === 'confirmed') return { ...base, title: MASKED_TITLES.private, masked: true };
  if (d.status === 'pending') return { ...base, title: MASKED_TITLES.pending, masked: true };
  return null;
}

module.exports = { projectPublicEvent, MASKED_TITLES };
