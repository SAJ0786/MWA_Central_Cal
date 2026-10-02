// Lightweight unit tests for the venue buffer/overlap logic (no test framework is
// installed in this repo, so this uses Node's built-in test runner: `node --test`).
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBufferHours, rangesOverlapBuffered } = require('./conflictUtils');

test('resolveBufferHours prefers bufferHours when present', () => {
  assert.equal(resolveBufferHours({ bufferHours: 1.5 }), 1.5);
  assert.equal(resolveBufferHours({ bufferHours: 0 }), 0);
});

test('resolveBufferHours falls back to legacy bufferMinutes / 60', () => {
  assert.equal(resolveBufferHours({ bufferMinutes: 30 }), 0.5);
  assert.equal(resolveBufferHours({ bufferMinutes: 90 }), 1.5);
});

test('resolveBufferHours defaults to 0 for missing/invalid/null data', () => {
  assert.equal(resolveBufferHours(null), 0);
  assert.equal(resolveBufferHours({}), 0);
  assert.equal(resolveBufferHours({ bufferHours: 'not-a-number' }), 0);
});

test('zero buffer: back-to-back bookings do not conflict, true overlap still does', () => {
  const otherStart = '2026-01-01T10:00:00.000Z';
  const otherEnd = '2026-01-01T12:00:00.000Z';
  // Candidate starts exactly when the other ends -> no overlap at zero buffer.
  assert.equal(rangesOverlapBuffered(otherEnd, '2026-01-01T13:00:00.000Z', otherStart, otherEnd, 0), false);
  // Candidate genuinely overlaps the existing booking.
  assert.equal(rangesOverlapBuffered('2026-01-01T11:00:00.000Z', '2026-01-01T13:00:00.000Z', otherStart, otherEnd, 0), true);
});

test('post-booking buffer extends the existing booking end, flags a candidate starting within it', () => {
  const otherStart = '2026-01-01T10:00:00.000Z';
  const otherEnd = '2026-01-01T12:00:00.000Z'; // + 1hr buffer -> effectively busy until 13:00
  // Candidate starts at 12:30, inside the 1hr buffer window after the existing booking ends.
  assert.equal(
    rangesOverlapBuffered('2026-01-01T12:30:00.000Z', '2026-01-01T14:00:00.000Z', otherStart, otherEnd, 1),
    true
  );
  // Candidate starts exactly at the buffer boundary (13:00) -> not a conflict (strict <).
  assert.equal(
    rangesOverlapBuffered('2026-01-01T13:00:00.000Z', '2026-01-01T14:00:00.000Z', otherStart, otherEnd, 1),
    false
  );
  // Candidate starts just after the buffer boundary -> not a conflict.
  assert.equal(
    rangesOverlapBuffered('2026-01-01T13:01:00.000Z', '2026-01-01T14:00:00.000Z', otherStart, otherEnd, 1),
    false
  );
});

test('buffer supports fractional hours (e.g. 0.5h = 30 minutes)', () => {
  const otherStart = '2026-01-01T10:00:00.000Z';
  const otherEnd = '2026-01-01T12:00:00.000Z';
  // 20 minutes after end, within a 30-minute (0.5h) buffer -> conflict.
  assert.equal(
    rangesOverlapBuffered('2026-01-01T12:20:00.000Z', '2026-01-01T13:00:00.000Z', otherStart, otherEnd, 0.5),
    true
  );
  // 40 minutes after end, outside a 30-minute buffer -> no conflict.
  assert.equal(
    rangesOverlapBuffered('2026-01-01T12:40:00.000Z', '2026-01-01T13:00:00.000Z', otherStart, otherEnd, 0.5),
    false
  );
});

test('buffer is one-directional: it never extends before the existing booking start', () => {
  const otherStart = '2026-01-01T10:00:00.000Z';
  const otherEnd = '2026-01-01T12:00:00.000Z';
  // Candidate ends exactly when the other starts -> no overlap, regardless of buffer
  // (buffer only applies after the existing booking's end, never before its start).
  assert.equal(
    rangesOverlapBuffered('2026-01-01T08:00:00.000Z', otherStart, otherStart, otherEnd, 2),
    false
  );
});
