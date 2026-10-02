// Shape of the live-conflict callable response. Public callers only learn that a conflict
// exists (and how many) — never which booking, its title, contact or time. Admins get detail.
function buildConflictResponse(overlaps, isAdmin) {
  const base = { hasConflict: overlaps.length > 0, count: overlaps.length };
  if (!isAdmin) return base;
  return {
    ...base,
    conflicts: overlaps.map(o => ({
      id: o.id, title: o.title || '', status: o.status || '',
      startAt: o.startAt, endAt: o.endAt,
      departmentName: o.departmentName || '', contactName: o.contactName || '', visibility: o.visibility || ''
    }))
  };
}

module.exports = { buildConflictResponse };
