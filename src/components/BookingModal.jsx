import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS, hijriToGregorian, getHijriParts } from '../services/hijriService.js';
import { localToUtcIso, formatInOrgTz, dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import { submitBooking, decideBooking, updateBooking } from '../services/eventsService.js';

const todayStr = () => dateKeyInOrgTz(new Date().toISOString());

export default function BookingModal({
  open, onClose, venues, departments, editing, isAdmin, hijriOverrides, onSaved, initialDate
}) {
  const [form, setForm] = useState(() => emptyForm(editing, initialDate, isAdmin));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  // Disables the submit button after a *successful* submission until the
  // user edits any field again — prevents accidental double-submits while
  // still letting a failed attempt be retried immediately (see `set` below,
  // which clears this on every field edit).
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setForm(emptyForm(editing, initialDate, isAdmin));
    setErr(''); setOk(''); setLocked(false);
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

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setLocked(false); }

  async function handlePublicSubmit(e) {
    e.preventDefault();
    setErr(''); setOk('');
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
      await updateBooking(editing.id, {
        title: form.title, departmentId: form.departmentId, venueId: form.venueId,
        startAt, endAt, notes: form.notes,
        contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
        visibility: form.visibility
      });
      setOk('Booking updated.');
      setLocked(true);
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

  return (
    <div className="overlay show" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>
        <h3 id="booking-modal-title" style={{ marginTop: 0, paddingRight: 36 }}>{editing ? 'Booking details' : 'New booking request'}</h3>

        <form onSubmit={isAdmin && editing ? handleAdminSave : handlePublicSubmit}>
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
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
              {hijriPreview && <div className="muted">≈ {hijriPreview} (moon-sighting adjustment applied)</div>}
              {editing && editing.dateBasis === 'hijri' && (
                <div className="muted">
                  This booking is anchored to its Hijri date — its Gregorian date is recomputed automatically if the moon-sighting adjustment changes. Changing the date/time here will detach it and fix it to this Gregorian date instead.
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

          {/* Visibility: public submitters default to Public (pending bookings stay
              hidden from public views regardless, until confirmed); an admin
              creating a booking defaults to Private and may choose either; an
              admin editing an existing booking can change it at any time. */}
          <label>Visibility {editing ? '' : '(once confirmed)'}</label>
          <select value={form.visibility} onChange={e => set('visibility', e.target.value)} disabled={!isAdmin && !!editing}>
            <option value="public">Public (shown on the community calendar)</option>
            <option value="private">Private (internal only)</option>
          </select>
          {!isAdmin && !editing && (
            <div className="muted">Your request stays hidden until an admin confirms it, regardless of this setting.</div>
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
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn pri" disabled={busy} onClick={() => decide('confirmed')}>Confirm</button>
                    <button type="button" className="btn del" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
                  </div>
                </>
              )}
              {isAdmin && editing.status !== 'cancelled' && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn del" disabled={busy} onClick={() => decide('cancelled')}>Cancel booking</button>
                </div>
              )}
            </div>
          )}

          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {(isAdmin && editing) ? <button className="btn pri" disabled={busy || locked} type="submit">Save changes</button>
              : !editing ? <button className="btn pri" disabled={busy || locked} type="submit">Submit request</button> : null}
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
    // Safe defaults per the visibility rule: public submitters default to
    // public (harmless while pending), admin-created bookings default private.
    visibility: isAdmin ? 'private' : 'public', decisionNote: ''
  };
}

// Pre-fills an edit form's time input from a stored UTC instant. Must read
// the org timezone's wall-clock hour/minute — using Date#getHours/getMinutes
// here would read the *browser's* local timezone instead, which silently
// shifted displayed (and, if saved back, persisted) booking times whenever
// the browser wasn't itself set to Australia/Sydney (e.g. 12:00–16:00 Sydney
// showing/saving as a different clock time entirely).
function isoTime(iso) {
  if (!iso) return '09:00';
  return timeKeyInOrgTz(iso) || '09:00';
}
