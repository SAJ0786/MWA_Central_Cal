import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS, hijriToGregorian, getHijriParts } from '../services/hijriService.js';
import { localToUtcIso, formatInOrgTz } from '../utils/dateUtils.js';
import { submitBooking, decideBooking, updateBooking } from '../services/eventsService.js';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function BookingModal({
  open, onClose, venues, departments, editing, isAdmin, hijriOverrides, onSaved, initialDate
}) {
  const [form, setForm] = useState(() => emptyForm(editing, initialDate));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(emptyForm(editing, initialDate)); setErr(''); setOk(''); }, [editing, open, initialDate]);

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

  if (!open) return null;

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

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
        notes: form.notes, requestPublicListing: !!form.requestPublicListing
      };
      const res = await submitBooking(payload);
      setOk(res?.hasConflict
        ? 'Request submitted as Pending. Note: it overlaps another booking at this venue — the admin team will review it.'
        : 'Request submitted as Pending. You will be notified once it is reviewed.');
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
        contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone
      });
      setOk('Booking updated.');
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
        visibility: status === 'confirmed' ? (form.visibility || 'private') : undefined,
        note: form.decisionNote || ''
      });
      setOk(`Booking marked ${status}.`);
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.message || 'Could not update status.');
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay show">
      <div className="dlg">
        <h3 style={{ marginTop: 0 }}>{editing ? 'Booking details' : 'New booking request'}</h3>

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
              {gregorianDate ? `= ${formatInOrgTz(gregorianDate + 'T12:00:00', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'Not a valid Hijri date'}
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

          {!editing && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.requestPublicListing}
                onChange={e => set('requestPublicListing', e.target.checked)} />
              Request a public listing (visible to the public once approved; otherwise kept private)
            </label>
          )}

          {editing && (
            <div className="card" style={{ marginTop: 14 }}>
              <div><b>Status:</b> <span className={`tag st-${editing.status}`}>{editing.status}</span>
                {editing.hasConflict && <span className="conflict-badge">Overlaps another booking at this venue</span>}
              </div>
              <div className="muted">Visibility: {editing.visibility || 'private'}</div>
              {isAdmin && editing.status === 'pending' && (
                <>
                  <label>Visibility if confirmed</label>
                  <select value={form.visibility} onChange={e => set('visibility', e.target.value)}>
                    <option value="private">Private (internal only)</option>
                    <option value="public">Public (shown on public calendar)</option>
                  </select>
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
            {(isAdmin && editing) ? <button className="btn pri" disabled={busy} type="submit">Save changes</button>
              : !editing ? <button className="btn pri" disabled={busy} type="submit">Submit request</button> : null}
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function emptyForm(editing, initialDate) {
  if (editing) {
    const d = new Date(editing.startAt);
    const e = new Date(editing.endAt);
    const dateKey = editing.startAt ? new Date(editing.startAt).toISOString().slice(0, 10) : todayStr();
    return {
      title: editing.title || '', departmentId: editing.departmentId || '', venueId: editing.venueId || '',
      basis: 'g', date: dateKey,
      hDay: '', hMonth: '1', hYear: '',
      start: isoTime(editing.startAt), end: isoTime(editing.endAt),
      contactName: editing.contactName || '', contactEmail: editing.contactEmail || '', contactPhone: editing.contactPhone || '',
      notes: editing.notes || '', requestPublicListing: editing.visibility === 'public',
      visibility: editing.visibility || 'private', decisionNote: ''
    };
  }
  return {
    title: '', departmentId: '', venueId: '', basis: 'g', date: initialDate || todayStr(),
    hDay: '', hMonth: '1', hYear: '',
    start: '09:00', end: '10:00',
    contactName: '', contactEmail: '', contactPhone: '', notes: '', requestPublicListing: false,
    visibility: 'private', decisionNote: ''
  };
}

function isoTime(iso) {
  if (!iso) return '09:00';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
