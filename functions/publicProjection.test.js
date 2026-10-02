const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPublicEvent, MASKED_TITLES } = require('./publicProjection');

const raw = (over) => ({
  title: 'SECRET-TITLE', departmentId: 'dept-secret', departmentName: 'DEPT-SECRET',
  venueId: 'v1', venueName: 'Main Hall',
  startAt: '2026-10-10T01:00:00.000Z', endAt: '2026-10-10T05:00:00.000Z',
  status: 'confirmed', visibility: 'public', dateBasis: 'gregorian',
  contactName: 'CONTACT-NAME', contactEmail: 'secret@example.com', contactPhone: '0400-SECRET',
  notes: 'NOTES-SECRET', hasConflict: true, conflictWith: ['other-id'], requestedVisibility: 'public',
  createdByUid: 'uid-secret', decisionNote: 'DECISION-SECRET', seriesId: 'series-secret',
  ...over
});
const LEAK = ['CONTACT-NAME', 'secret@example.com', '0400-SECRET', 'NOTES-SECRET', 'other-id', 'uid-secret', 'DECISION-SECRET', 'series-secret'];
const noLeak = (p) => { const s = JSON.stringify(p); for (const t of LEAK) assert.ok(!s.includes(t), `leaked ${t}`); };

test('confirmed + public exposes full public fields only', () => {
  const p = projectPublicEvent(raw(), 'e1', { day: 1, month: 1, year: 1448 });
  assert.equal(p.title, 'SECRET-TITLE');
  assert.equal(p.masked, false);
  assert.equal(p.departmentName, 'DEPT-SECRET');
  noLeak(p);
  for (const k of ['contactName', 'contactEmail', 'notes', 'hasConflict', 'conflictWith']) assert.ok(!(k in p));
});

test('confirmed + private is masked as "Private" with no title/department/contact', () => {
  const p = projectPublicEvent(raw({ visibility: 'private' }), 'e1', null);
  assert.equal(p.title, MASKED_TITLES.private);
  assert.equal(p.masked, true);
  assert.equal(p.venueName, 'Main Hall');
  noLeak(p);
  const s = JSON.stringify(p);
  assert.ok(!s.includes('SECRET-TITLE') && !s.includes('DEPT-SECRET') && !s.includes('dept-secret'));
});

test('confirmed with missing visibility defaults to masked (safe default)', () => {
  assert.equal(projectPublicEvent(raw({ visibility: undefined }), 'e1').masked, true);
});

test('pending is masked as "Unconfirmed booking" regardless of visibility', () => {
  for (const visibility of ['public', 'private']) {
    const p = projectPublicEvent(raw({ status: 'pending', visibility }), 'e1', null);
    assert.equal(p.title, 'Unconfirmed booking');
    assert.equal(p.status, 'pending');
    assert.equal(p.masked, true);
    noLeak(p);
    assert.ok(!JSON.stringify(p).includes('SECRET-TITLE'));
    assert.ok(!('visibility' in p));
  }
});

test('rejected / cancelled are never exposed', () => {
  assert.equal(projectPublicEvent(raw({ status: 'rejected' }), 'e1'), null);
  assert.equal(projectPublicEvent(raw({ status: 'cancelled' }), 'e1'), null);
  assert.equal(projectPublicEvent(null, 'e1'), null);
});

test('unknown extra fields on the raw doc never pass through (whitelist)', () => {
  const p = projectPublicEvent(raw({ futureField: 'FUTURE-SECRET', status: 'pending' }), 'e1');
  assert.ok(!JSON.stringify(p).includes('FUTURE-SECRET'));
});
