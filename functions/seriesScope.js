// Edit/delete scope for recurring series, mirroring the Community Events app's
// "this event / this and future / all events" choices.
const { localToUtcIso, toOrgTimeParts } = require('./dateUtils');

const SCOPES = ['single', 'future', 'all'];

function normalizeScope(scope) {
  return SCOPES.includes(scope) ? scope : 'single';
}

/**
 * Pick the occurrences a scoped action applies to.
 * @param {{id:string, seriesId?:string, startAt:string}[]} seriesDocs every doc of the anchor's series
 * @param {{id:string, seriesId?:string, startAt:string}} anchor the occurrence the admin acted on
 */
function selectSeriesTargets(seriesDocs, anchor, scope) {
  const s = normalizeScope(scope);
  if (s === 'single' || !anchor.seriesId) return [anchor];
  const sameSeries = seriesDocs.filter(d => d.seriesId === anchor.seriesId);
  const targets = s === 'all' ? sameSeries : sameSeries.filter(d => d.startAt >= anchor.startAt);
  if (!targets.some(d => d.id === anchor.id)) targets.push(anchor);
  return targets.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Apply new Sydney wall-clock start/end times to an occurrence, keeping its own civil date. */
function retimeOccurrence(occurrence, startTime, endTime) {
  const { dateStr } = toOrgTimeParts(occurrence.startAt);
  return {
    startAt: localToUtcIso(dateStr, startTime),
    endAt: localToUtcIso(dateStr, endTime)
  };
}

module.exports = { SCOPES, normalizeScope, selectSeriesTargets, retimeOccurrence };
