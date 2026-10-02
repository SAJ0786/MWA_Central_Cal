import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS, hijriToGregorian, getHijriParts } from '../services/hijriService.js';
import { localToUtcIso, formatInOrgTz, dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import {
  submitBooking, decideBooking, updateBookingScoped, createRecurringBooking, deleteBooking
} from '../services/eventsService.js';

const todayStr = () => dateKeyInOrgTz(new Date().toISOString());
const DEFAULT_REPEAT = { on: false, frequency: 'week', repeatEvery: 1, endMode: 'count', count: 10, endDate: '', status: 'confirmed' };

export default function BookingModal({
  open, onClose, venues, departments, editing, isAdmin, hijriOverrides, onSaved, initialDate
}) {
  const [form, setForm] = useState(() => emptyForm(editing, initialDate, isAdmin));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  // Disables the submit button after a *successful* submission until the
  // user edits any field again; failed attempts stay retryable.
  const [locked, setLocked] = useState(false);
  // Existing bookings open read-only; admins press Edit to enable the fields.
  const [editMode, setEditMode] = useState(false);
  const [scope, setScope] = useState('single');
  const [rep, setRep] = useState(DEFAULT_REPEAT);

  useEffect(() => {
    setForm(emptyForm(editing, initialDate, isAdmin));
    setErr(''); setOk(''); setLocked(false); setEditMode(false); setScope('single');
    setRep(DEFAULT_REPEAT);
  }, [editing, open, initialDate, isAdmin]);

  const gregorianDate = useMemo(() => {
    if (form.basis === 'g') return form.date;
    if (!form.hDay || !form.hMonth || !form.hYear) return '';
    return hijriToGregorian(Number(form.hDay), Number(form.hMonth), Number(form.hYear), hijriOverrides) || '';
  }, [form.basis, form.date, form.hDay, form.hMonth, form.hYear, hijriOverrides]);

  const hijriPreview = useMemo(() => {
    if (form.basis !== 'g' || !form.date) return '';
    const h = getHijriParts(form.date, hijriOverrides);
    if (!h.year) return '';
    const name = HIJRI_MONTHS.find(m => m.value === h.month)?.name || '';
    return `${h.day} ${name} ${h.year} AH`;
  }, [form.basis, form.date, hijriOverrides]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) { if (e.key === 'Escape') onClose && onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isSeries = !!(editing && editing.seriesId);
  const readOnly = !!editing && !editMode;

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setLocked(false); }
  function setR(k, v) { setRep(r => ({ ...r, [k]: v })); setLocked(false); }
  function cancelEdit() { setForm(emptyForm(editing, initialDate, isAdmin)); setEditMode(false); setErr(''); setOk(''); }

  const closeButton = <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>;

  // Non-admins never receive contact/notes; masked items carry only date/time/venue.
  if (editing && !isAdmin) {
    const dateLabel = formatInOrgTz(editing.startAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const h = editing.hijri;
    const hijriLabel = h && h.year ? `${h.day} ${HIJRI_MONTHS.find(m => m.value === h.month)?.name || ''} ${h.year} AH` : '';
    return (
      <div className="overlay show" onClick={onClose}>
        <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title" onClick={e => e.stopPropagation()}>
          {closeButton}
          <h3 id="booking-modal-title" style={{ marginTop: 0, paddingRight: 36 }}>{editing.title}</h3>
          <div className="card">
            <div><span className={`tag st-${editing.status}`}>{editing.status === 'pending' ? 'unconfirmed' : editing.status}</span></div>
            <div style={{ marginTop: 8 }}><b>Date:</b> {dateLabel}</div>
            {hijriLabel && <div><b>Hijri:</b> {hijriLabel}</div>}
            <div><b>Time:</b> {formatInOrgTz(editing.startAt, { hour: '2-digit', minute: '2-digit', hour12: false })} – {formatInOrgTz(editing.endAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
            {editing.venueName && <div><b>Venue:</b> {editing.venueName}</div>}
            {!editing.masked && editing.departmentName && <div><b>Department:</b> {editing.departmentName}</div>}
          </div>
        </div>
      </div>
    );
  }

  async function handleRecurringCreate() {
    if (!form.title || !form.departmentId || !form.venueId || !form.start || !form.end || !form.contactName || !form.contactEmail) {
      setErr('Please fill in title, department, venue, times and contact details.'); return;
    }
    if (form.end <= form.start) { setErr('End time must be after start time.'); return; }
    const recurrence = {
      basis: form.basis === 'h' ? 'hijri' : 'gregorian',
      startTime: form.start, endTime: form.end,
      frequency: rep.frequency, repeatEvery: Number(rep.repeatEvery),
      endMode: rep.endMode, count: Number(rep.count), endDate: rep.endDate
    };
    if (form.basis === 'h') recurrence.hijriStart = { day: Number(form.hDay), month: Number(form.hMonth), year: Number(form.hYear) };
    else recurrence.startDate = form.date;
    setBusy(true);
    try {
      const res = await createRecurringBooking({
        title: form.title, departmentId: form.departmentId, venueId: form.venueId,
        contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
        notes: form.notes, visibility: form.visibility, status: rep.status, recurrence
      });
      setOk(`Created ${res.created} occurrence(s) as ${res.status}.` +
        (res.conflicts ? ` ${res.conflicts} overlap another booking at this venue and are flagged for review.` : ''));
      setLocked(true);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not create the recurring booking.');
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    const what = isSeries && scope !== 'single'
      ? (scope === 'all' ? 'ALL occurrences in this series' : 'this and all future occurrences')
      : 'this booking';
    if (!window.confirm(`Permanently delete ${what}? This cannot be undone.`)) return;
    setErr(''); setOk(''); setBusy(true);
    try {
      const res = await deleteBooking(editing.id, isSeries ? scope : 'single');
      setOk(`Deleted ${res.deleted} booking(s).`);
      onSaved && onSaved();
      onClose && onClose();
    } catch (e2) {
      setErr(e2?.message || 'Could not delete.');
    } finally { setBusy(false); }
  }

  async function handlePublicSubmit(e) {
    e.preventDefault();
    setErr(''); setOk('');
    if (isAdmin && rep.on) { await handleRecurringCreate(); return; }
    if (!form.title || !form.departmentId || !form.venueId || !gregorianDate || !form.start || !form.end) {
      setErr('Please fill in title, department, venue, date and times.'); return;
    }
    const startAt = localToUtcIso(gregorianDate, form.start);
    const endAt = localToUtcIso(gregorianDate, form.end);
    if (new Date(endAt) <= new Date(startAt)) { setErr('End time must be after start time.'); return; }
    setBusy(true);
    try {
      const payload = {
        title: form.title, departmentId: form.departmentId, venueId: form.venueId,
        startAt, endAt,
        dateBasis: form.basis,
        hijriDate: form.basis === 'h' ? { day: Number(form.hDay), month: Number(form.hMonth), year: Number(form.hYear) } : null,
        contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
        notes: form.notes, visibility: form.visibility
      };
      const res = await submitBooking(payload);
      setOk(res?.hasConflict
        ? 'Request submitted as Pending. Note: it overlaps another booking at this venue — the admin team will review it.'
        : 'Request submitted as Pending. You will be notified once it is reviewed.');
      setLocked(true);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not submit the booking. Please try again.');
    } finally { setBusy(false); }
  }

  async function handleAdminSave(e) {
    e.preventDefault();
    setErr(''); setOk('');
    setBusy(true);
    try {
      const startAt = localToUtcIso(gregorianDate, form.start);
      const endAt = localToUtcIso(gregorianDate, form.end);
      await updateBookingScoped(editing.id, {
        title: form.title, departmentId: form.departmentId, venueId: form.venueId,
        startAt, endAt, notes: form.notes,
        contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
        visibility: form.visibility
      }, isSeries ? scope : 'single');
      setOk('Booking updated.');
      setLocked(true);
      setEditMode(false);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not save changes.');
    } finally { setBusy(false); }
  }

  async function decide(status) {
    setErr(''); setOk('');
    setBusy(true);
    try {
      await decideBooking({
        eventId: editing.id, status,
        visibility: form.visibility,
        note: form.decisionNote || ''
      });
      setOk(`Booking marked ${status}.`);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not update status.');
    } finally { setBusy(false); }
  }

  const repeating = isAdmin && !editing && rep.on;

  return (
    <div className="overlay show" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title" onClick={e => e.stopPropagation()}>
        {closeButton}
        <h3 id="booking-modal-title" style={{ marginTop: 0, paddingRight: 36 }}>{editing ? 'Booking details' : 'New booking request'}</h3>

        {isAdmin && editing && !editMode && (
          <div style={{ marginBottom: 8 }}>
            <button type="button" className="btn pri" onClick={() => { setEditMode(true); setLocked(false); setOk(''); }}>Edit</button>
          </div>
        )}

        <form onSubmit={isAdmin && editing ? handleAdminSave : handlePublicSubmit}>
          <fieldset className="dlg-fields" disabled={readOnly}>
            <label>Title</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} required />

            <div className="r2">
              <div>
                <label>Department</label>
                <select value={form.departmentId} onChange={e => set('departmentId', e.target.value)} required>
                  <option value="">Select…</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label>Venue</label>
                <select value={form.venueId} onChange={e => set('venueId', e.target.value)} required>
                  <option value="">Select…</option>
                  {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>

            {!editing && (
              <>
                <label>Date based on</label>
                <select value={form.basis} onChange={e => set('basis', e.target.value)}>
                  <option value="g">Gregorian</option>
                  <option value="h">Hijri (Islamic)</option>
                </select>
              </>
            )}

            {form.basis === 'g' || editing ? (
              <>
                <label>{repeating ? 'First date' : 'Date'}</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
                {hijriPreview && <div className="muted">≈ {hijriPreview} (moon-sighting adjustment applied)</div>}
                {editing && editing.dateBasis === 'hijri' && (
                  <div className="muted">
                    This booking is anchored to its Hijri date — its Gregorian date is recomputed automatically if the moon-sighting adjustment changes. Changing the date here will detach it and fix it to this Gregorian date instead.
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 10 }}>
                <div><label>Day</label><input type="number" min="1" max="30" value={form.hDay} onChange={e => set('hDay', e.target.value)} /></div>
                <div>
                  <label>Month</label>
                  <select value={form.hMonth} onChange={e => set('hMonth', e.target.value)}>
                    {HIJRI_MONTHS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
                  </select>
                </div>
                <div><label>Year (AH)</label><input type="number" value={form.hYear} onChange={e => set('hYear', e.target.value)} /></div>
              </div>
            )}
            {form.basis === 'h' && !editing && (
              <div className="muted">
                {gregorianDate ? `= ${formatInOrgTz(localToUtcIso(gregorianDate, '12:00'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'Not a valid Hijri date'}
              </div>
            )}

            <div className="r2">
              <div><label>Start</label><input type="time" value={form.start} onChange={e => set('start', e.target.value)} required /></div>
              <div><label>End</label><input type="time" value={form.end} onChange={e => set('end', e.target.value)} required /></div>
            </div>

            <div className="r2">
              <div><label>Contact name</label><input value={form.contactName} onChange={e => set('contactName', e.target.value)} required /></div>
              <div><label>Contact email</label><input type="email" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} required /></div>
            </div>
            <label>Contact phone (optional)</label>
            <input value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} />
            <label>Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />

            {/* Public submitters default to Public; admin-created bookings default to
                Private. Private and pending bookings appear publicly only as masked items. */}
            <label>Visibility</label>
            <select value={form.visibility} onChange={e => set('visibility', e.target.value)}>
              <option value="public">Public (title and details shown on the calendar)</option>
              <option value="private">Private (shown publicly only as “Private”)</option>
            </select>
            {!isAdmin && !editing && (
              <div className="muted">Your request appears on the calendar as “Unconfirmed booking” until an admin reviews it.</div>
            )}

            {isAdmin && !editing && (
              <div className="card" style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={rep.on} onChange={e => setR('on', e.target.checked)} />
                  Repeat this booking
                </label>
                {rep.on && (
                  <>
                    <div className="r2">
                      <div>
                        <label>Repeats</label>
                        <select value={rep.frequency} onChange={e => setR('frequency', e.target.value)}>
                          <option value="day">Daily</option>
                          <option value="week">Weekly</option>
                          <option value="month">Monthly</option>
                          <option value="year">Yearly</option>
                        </select>
                      </div>
                      <div>
                        <label>Every</label>
                        <input type="number" min="1" max="100" value={rep.repeatEvery} onChange={e => setR('repeatEvery', e.target.value)} />
                      </div>
                    </div>
                    <div className="r2">
                      <div>
                        <label>Ends</label>
                        <select value={rep.endMode} onChange={e => setR('endMode', e.target.value)}>
                          <option value="count">After a number of occurrences</option>
                          <option value="date">On a date</option>
                        </select>
                      </div>
                      <div>
                        {rep.endMode === 'count'
                          ? <><label>Occurrences</label><input type="number" min="1" max="370" value={rep.count} onChange={e => setR('count', e.target.value)} /></>
                          : <><label>End date</label><input type="date" value={rep.endDate} onChange={e => setR('endDate', e.target.value)} /></>}
                      </div>
                    </div>
                    <label>Create as</label>
                    <select value={rep.status} onChange={e => setR('status', e.target.value)}>
                      <option value="confirmed">Confirmed</option>
                      <option value="pending">Pending</option>
                    </select>
                    <div className="muted">Up to one year ahead (yearly: 5 occurrences). {form.basis === 'h' ? 'Hijri-anchored: each occurrence follows its Hijri date. ' : ''}Overlapping occurrences are created and flagged for review.</div>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {isSeries && isAdmin && (
            <div className="card" style={{ marginTop: 14 }}>
              <b>Recurring series</b>{editing.seriesIndex ? ` — occurrence ${editing.seriesIndex} of ${editing.seriesCount}` : ''}
              <label>Apply edits / delete to</label>
              <select value={scope} onChange={e => setScope(e.target.value)}>
                <option value="single">This occurrence only</option>
                <option value="future">This and following occurrences</option>
                <option value="all">All occurrences</option>
              </select>
              {scope !== 'single' && <div className="muted">Edits to several occurrences apply shared fields and the time of day; dates can only be changed for a single occurrence.</div>}
            </div>
          )}

          {editing && (
            <div className="card" style={{ marginTop: 14 }}>
              <div><b>Status:</b> <span className={`tag st-${editing.status}`}>{editing.status}</span>
                {editing.hasConflict && <span className="conflict-badge">Overlaps another booking at this venue</span>}
              </div>
              {isAdmin && editing.status === 'pending' && (
                <>
                  <label>Decision note (optional)</label>
                  <input value={form.decisionNote} onChange={e => set('decisionNote', e.target.value)} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn pri" disabled={busy} onClick={() => decide('confirmed')}>Approve</button>
                    <button type="button" className="btn del" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
                  </div>
                </>
              )}
              {isAdmin && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {editing.status !== 'cancelled' && (
                    <button type="button" className="btn del" disabled={busy} onClick={() => decide('cancelled')}>Cancel booking</button>
                  )}
                  <button type="button" className="btn del" disabled={busy} onClick={handleDelete}>Delete</button>
                </div>
              )}
            </div>
          )}

          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {isAdmin && editing && editMode && (
              <>
                <button className="btn pri" disabled={busy || locked} type="submit">Save changes</button>
                <button className="btn" disabled={busy} type="button" onClick={cancelEdit}>Cancel</button>
              </>
            )}
            {!editing && (
              <button className="btn pri" disabled={busy || locked} type="submit">{repeating ? 'Create series' : 'Submit request'}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function emptyForm(editing, initialDate, isAdmin) {
  if (editing) {
    const dateKey = editing.startAt ? dateKeyInOrgTz(editing.startAt) : todayStr();
    return {
      title: editing.title || '', departmentId: editing.departmentId || '', venueId: editing.venueId || '',
      basis: 'g', date: dateKey,
      hDay: '', hMonth: '1', hYear: '',
      start: isoTime(editing.startAt), end: isoTime(editing.endAt),
      contactName: editing.contactName || '', contactEmail: editing.contactEmail || '', contactPhone: editing.contactPhone || '',
      notes: editing.notes || '',
      visibility: editing.visibility || 'private', decisionNote: ''
    };
  }
  return {
    title: '', departmentId: '', venueId: '', basis: 'g', date: initialDate || todayStr(),
    hDay: '', hMonth: '1', hYear: '',
    start: '09:00', end: '10:00',
    contactName: '', contactEmail: '', contactPhone: '', notes: '',
    visibility: isAdmin ? 'private' : 'public', decisionNote: ''
  };
}

// Reads the org timezone's wall-clock time (never the browser's local zone).
function isoTime(iso) {
  if (!iso) return '09:00';
  return timeKeyInOrgTz(iso) || '09:00';
}
