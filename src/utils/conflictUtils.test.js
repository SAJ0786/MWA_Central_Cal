import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAllConflicts, isWholeSiteVenue, resolveBufferHours } from './conflictUtils.js';

// Real live shapes: venues keep legacy bufferMinutes or bufferHours; Cricket is at "Entire MWA Precinct".
const venues = [
  { id: 'MfpAG9IHIIeYxVyAIAvm', name: 'Main Hall', bufferHours: 3 },
  { id: 'G7Kxfjo7wDdERofCq85Z', name: 'Entire MWA Precinct', bufferMinutes: 300 },
  { id: 'c69SydJSMkqGkFcshr3o', name: 'Hall 2', bufferHours: 3 }
];
const cricket = { id: 'c', status: 'confirmed', venueId: 'G7Kxfjo7wDdERofCq85Z', startAt: '2026-10-04T23:30:00.000Z', endAt: '2026-10-05T04:00:00.000Z' };
const seminar = { id: 's', status: 'pending', venueId: 'MfpAG9IHIIeYxVyAIAvm', startAt: '2026-10-05T05:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z' };

test('legacy bufferMinutes falls back to hours; whole-site detection', () => {
  assert.equal(resolveBufferHours(venues[1]), 5);
  assert.equal(isWholeSiteVenue(venues[1]), true);
  assert.equal(isWholeSiteVenue({ name: 'Entire X', coversAllVenues: false }), false);
  assert.equal(isWholeSiteVenue(venues[0]), false);
});

test('screenshot scenario: Precinct booking conflicts with Main Hall seminar after its 5h buffer', () => {
  const m = computeAllConflicts([cricket, seminar], venues);
  assert.deepEqual(m.get('s'), ['c']);
  assert.deepEqual(m.get('c'), ['s']);
});

test('same venue, 3h buffer: 10:30-15:00 vs 16:00-20:00 conflicts; 18:30 start does not', () => {
  const a = { id: 'a', status: 'confirmed', venueId: 'MfpAG9IHIIeYxVyAIAvm', startAt: cricket.startAt, endAt: cricket.endAt };
  assert.deepEqual(computeAllConflicts([a, seminar], venues).get('s'), ['a']);
  const late = { ...seminar, startAt: '2026-10-05T07:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z' };
  assert.deepEqual(computeAllConflicts([a, late], venues).get('s'), []);
});

test('exact same time same venue conflicts; other venues and cancelled bookings do not', () => {
  const a = { ...seminar, id: 'a', status: 'confirmed' };
  const b = { ...seminar, id: 'b' };
  const other = { ...seminar, id: 'o', venueId: 'c69SydJSMkqGkFcshr3o' };
  const dead = { ...seminar, id: 'd', status: 'cancelled' };
  const m = computeAllConflicts([a, b, other, dead], venues);
  assert.deepEqual(m.get('a'), ['b']);
  assert.deepEqual(m.get('o'), []);
  assert.equal(m.has('d'), false);
});

