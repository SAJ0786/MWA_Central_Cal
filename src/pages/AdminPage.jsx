import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { watchAuditLog } from '../services/auditService.js';
import {
  createVenue, updateVenue, deleteVenue,
  createDepartment, updateDepartment, deleteDepartment
} from '../services/directoryService.js';
import { getHijriSettings, saveMonthOverride, removeMonthOverride } from '../services/calendarSettingsService.js';
import { HIJRI_MONTHS } from '../services/hijriService.js';
import BookingModal from '../components/BookingModal.jsx';

export default function AdminPage({ events, venues, departments, hijriOverrides, onSaved, onReloadSettings }) {
  const { user, profile, isAdmin, loading, login, logout } = useAuth();
  const [sub, setSub] = useState('pending');

  if (loading) return <section><p className="muted">Loading…</p></section>;
  if (!user || !isAdmin) return <LoginCard user={user} profile={profile} login={login} logout={logout} />;

  const pending = events.filter(e => e.status === 'pending');

  return (
    <section>
      <div className="bar">
        {['pending', 'venues', 'departments', 'audit', 'hijri'].map(s => (
          <button key={s} className={`tab ${sub === s ? 'on' : ''}`} onClick={() => setSub(s)}>
            {label(s)}{s === 'pending' && pending.length ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>
      {sub === 'pending' && <PendingTab pending={pending} venues={venues} departments={departments} hijriOverrides={hijriOverrides} onSaved={onSaved} />}
      {sub === 'venues' && <VenuesTab venues={venues} />}
      {sub === 'departments' && <DepartmentsTab departments={departments} />}
      {sub === 'audit' && <AuditTab />}
      {sub === 'hijri' && <HijriTab adjustedBy={user.email} onReloadSettings={onReloadSettings} />}
    </section>
  );
}

function label(s) {
  return { pending: 'Pending approvals', venues: 'Venues', departments: 'Departments', audit: 'Audit log', hijri: 'Hijri settings' }[s];
}

function LoginCard({ login }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await login(email, password); }
    catch (e2) { setErr('Sign-in failed. Check the email and password.'); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="card" style={{ maxWidth: 360, margin: '40px auto' }}>
        <h3 style={{ marginTop: 0 }}>Admin sign in</h3>
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {err && <div className="err">{err}</div>}
          <button className="btn pri" style={{ marginTop: 14 }} disabled={busy} type="submit">Sign in</button>
        </form>
        <p className="muted" style={{ marginTop: 14 }}>
          Admin accounts are created in the Firebase console (or by an existing admin); there is no public sign-up.
        </p>
      </div>
    </section>
  );
}

function PendingTab({ pending, venues, departments, hijriOverrides, onSaved }) {
  const [modal, setModal] = useState(null);
  return (
    <div className="wrap">
      <table>
        <thead><tr><th>Date</th><th>Event</th><th>Department</th><th>Venue</th><th>Conflict</th><th></th></tr></thead>
        <tbody>
          {pending.map(e => (
            <tr key={e.id}>
              <td>{new Date(e.startAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}</td>
              <td>{e.title}</td>
              <td>{e.departmentName || e.departmentId}</td>
              <td>{e.venueName || e.venueId}</td>
              <td>{e.hasConflict ? <span className="conflict-badge">overlap</span> : '—'}</td>
              <td><button className="btn" onClick={() => setModal({ editing: e })}>Review</button></td>
            </tr>
          ))}
          {!pending.length && <tr><td colSpan={6} className="muted">Nothing pending. 🎉</td></tr>}
        </tbody>
      </table>
      {modal && (
        <BookingModal open={true} onClose={() => setModal(null)} venues={venues} departments={departments}
          editing={modal.editing} isAdmin hijriOverrides={hijriOverrides} onSaved={onSaved} />
      )}
    </div>
  );
}

function VenuesTab({ venues }) {
  const [form, setForm] = useState({ name: '', capacity: '', bufferHours: '', openingHours: '' });
  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    await createVenue(form);
    setForm({ name: '', capacity: '', bufferHours: '', openingHours: '' });
  }
  return (
    <div>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label>Capacity</label><input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
        <div><label>Buffer (hours, after booking)</label><input type="number" step="0.25" min="0" value={form.bufferHours} onChange={e => setForm(f => ({ ...f, bufferHours: e.target.value }))} /></div>
        <button className="btn pri" type="submit">Add venue</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Capacity</th><th>Buffer</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {venues.map(v => (
            <tr key={v.id}>
              <td>{v.name}</td><td>{v.capacity ?? '—'}</td><td>{resolveVenueBufferHours(v)} hr</td>
              <td>
                <input type="checkbox" checked={v.active !== false} onChange={e => updateVenue(v.id, { active: e.target.checked })} />
              </td>
              <td><button className="btn del" onClick={() => deleteVenue(v.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Safe read-time fallback for venues created before the bufferMinutes -> bufferHours
// rename: prefer bufferHours, else convert legacy bufferMinutes, else 0. No destructive
// Firestore migration is required — every read resolves consistently.
function resolveVenueBufferHours(v) {
  if (v.bufferHours !== undefined && v.bufferHours !== null) return Number(v.bufferHours) || 0;
  if (v.bufferMinutes !== undefined && v.bufferMinutes !== null) return Math.round(((Number(v.bufferMinutes) || 0) / 60) * 100) / 100;
  return 0;
}

function DepartmentsTab({ departments }) {
  const [form, setForm] = useState({ name: '', colorHex: '#2563eb' });
  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    await createDepartment(form);
    setForm({ name: '', colorHex: '#2563eb' });
  }
  return (
    <div>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label>Colour</label><input type="color" value={form.colorHex} onChange={e => setForm(f => ({ ...f, colorHex: e.target.value }))} /></div>
        <button className="btn pri" type="submit">Add department</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Colour</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {departments.map(d => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: d.colorHex }} /></td>
              <td><input type="checkbox" checked={d.active !== false} onChange={e => updateDepartment(d.id, { active: e.target.checked })} /></td>
              <td><button className="btn del" onClick={() => deleteDepartment(d.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const [log, setLog] = useState([]);
  useEffect(() => watchAuditLog(setLog), []);
  return (
    <div className="wrap">
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>By</th><th>Note</th></tr></thead>
        <tbody>
          {log.map(l => (
            <tr key={l.id}>
              <td>{l.timestamp ? new Date(l.timestamp).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) : ''}</td>
              <td>{l.action}</td>
              <td>{l.entityType} {l.entityId}</td>
              <td>{l.userEmail || l.userId || 'system'}</td>
              <td>{l.note || ''}</td>
            </tr>
          ))}
          {!log.length && <tr><td colSpan={5} className="muted">No audit entries yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function HijriTab({ adjustedBy, onReloadSettings }) {
  const [settings, setSettings] = useState({ overrides: [] });
  const [form, setForm] = useState({ hYear: '', hMonth: '1', gDate: '' });
  const [err, setErr] = useState('');

  async function load() { setSettings(await getHijriSettings()); }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    setErr('');
    if (!form.hYear || !form.gDate) { setErr('Enter a Hijri year and the Gregorian date day 1 fell/falls on.'); return; }
    await saveMonthOverride(form.hYear, form.hMonth, form.gDate, adjustedBy);
    setForm({ hYear: '', hMonth: '1', gDate: '' });
    await load();
    onReloadSettings && onReloadSettings();
  }

  async function remove(o) {
    await removeMonthOverride(o.hYear, o.hMonth);
    await load();
    onReloadSettings && onReloadSettings();
  }

  return (
    <div>
      <p className="muted">
        Moon-sighting adjustment: anchor the first day of a Hijri month to the Gregorian date the
        community observed it on. This overrides the tabular calculation for that month onward
        (until a later override takes effect) and is used consistently across the public calendar,
        bookings list and iCal export.
      </p>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Hijri year</label><input type="number" value={form.hYear} onChange={e => setForm(f => ({ ...f, hYear: e.target.value }))} /></div>
        <div>
          <label>Hijri month</label>
          <select value={form.hMonth} onChange={e => setForm(f => ({ ...f, hMonth: e.target.value }))}>
            {HIJRI_MONTHS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
          </select>
        </div>
        <div><label>Day 1 fell on (Gregorian)</label><input type="date" value={form.gDate} onChange={e => setForm(f => ({ ...f, gDate: e.target.value }))} /></div>
        <button className="btn pri" type="submit">Save override</button>
      </form>
      {err && <div className="err">{err}</div>}
      <table>
        <thead><tr><th>Hijri month</th><th>Year</th><th>Day 1 (Gregorian)</th><th></th></tr></thead>
        <tbody>
          {(settings.overrides || []).map((o, i) => (
            <tr key={i}>
              <td>{HIJRI_MONTHS.find(m => m.value === Number(o.hMonth))?.name}</td>
              <td>{o.hYear}</td>
              <td>{o.gDate}</td>
              <td><button className="btn del" onClick={() => remove(o)}>Remove</button></td>
            </tr>
          ))}
          {!settings.overrides?.length && <tr><td colSpan={4} className="muted">No overrides saved — using the tabular calculation.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
