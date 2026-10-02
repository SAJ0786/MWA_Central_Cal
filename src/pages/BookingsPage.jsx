import { useMemo, useRef, useState } from 'react';
import { hijriLabel, dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import { downloadCsv, downloadIcs } from '../services/exportService.js';
import { importBookings, recomputeAllConflicts } from '../services/eventsService.js';
import {
  EXPORT_HEADERS, MAX_IMPORT_FILE_BYTES, bookingsToRows, templateRows, filterByDateRange
} from '../utils/excelUtils.js';
import BookingModal from '../components/BookingModal.jsx';

const MAX_ROWS = 500;

export default function BookingsPage({ events, venues, departments, isAdmin, hijriOverrides, onSaved }) {
  const [modal, setModal] = useState(null);
  // Optional range filter (no default limit: bookings of any age, e.g. 2+ years back, stay browsable).
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null); // { rows (parsed), result (dry-run) }
  const fileRef = useRef(null);

  const sorted = useMemo(() => {
    const list = filterByDateRange(events, from, to, dateKeyInOrgTz);
    return list.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [events, from, to]);

  const fmt = { dateKey: dateKeyInOrgTz, timeKey: timeKeyInOrgTz, hijri: (iso) => hijriLabel(iso, hijriOverrides) };

  function setRange(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    setFrom(dateKeyInOrgTz(d.toISOString())); setTo('');
  }

  async function exportXlsx() {
    setMsg('');
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...bookingsToRows(sorted, fmt)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
    XLSX.writeFile(wb, `mwa-bookings${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}.xlsx`);
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(templateRows()), 'Bookings');
    XLSX.writeFile(wb, 'mwa-bookings-import-template.xlsx');
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setMsg(''); setReport(null);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { setMsg('Please choose an .xlsx file.'); return; }
    if (file.size > MAX_IMPORT_FILE_BYTES) { setMsg('File is too large (max 2 MB).'); return; }
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (rows.length > MAX_ROWS) { setMsg(`Too many rows (${rows.length}). The limit is ${MAX_ROWS} per import.`); return; }
      const result = await importBookings(rows, true);
      setReport({ rows, result });
    } catch (err) {
      setMsg(err?.message || 'Could not read the file.');
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    setBusy(true); setMsg('');
    try {
      const res = await importBookings(report.rows, false);
      setMsg(`Import complete: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped. Overlaps are flagged, not blocked.`);
      setReport(null);
      onSaved && onSaved();
    } catch (err) {
      setMsg(err?.message || 'Import failed.');
    } finally { setBusy(false); }
  }

  async function recompute() {
    setBusy(true); setMsg('');
    try {
      const res = await recomputeAllConflicts();
      setMsg(`Conflicts recalculated across ${res.venues} venue(s); ${res.changed} booking(s) updated.`);
      onSaved && onSaved();
    } catch (err) {
      setMsg(err?.message || 'Could not recalculate conflicts.');
    } finally { setBusy(false); }
  }

  return (
    <section>
      <div className="bar range-bar">
        <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn" onClick={() => setRange(2)}>Last 2 years +</button>
        <button className="btn" onClick={() => { setFrom(''); setTo(''); }}>All time</button>
        <span className="muted">{sorted.length} of {events.length} bookings</span>
        <span className="sp" />
        <button className="btn" onClick={() => downloadCsv(sorted)}>Export CSV</button>
        <button className="btn" onClick={() => downloadIcs(sorted.filter(e => e.status === 'confirmed'))}>Export iCal (.ics)</button>
        {isAdmin && <button className="btn" onClick={exportXlsx}>Export Excel</button>}
      </div>

      {isAdmin && (
        <div className="bar">
          <button className="btn" disabled={busy} onClick={downloadTemplate}>Import template (.xlsx)</button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>Import Excel…</button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onFile} />
          <button className="btn" disabled={busy} onClick={recompute} title="Re-checks every booking against its venue's buffer">Recalculate conflicts</button>
        </div>
      )}
      {msg && <div className="card" role="status">{msg}</div>}

      {report && (
        <div className="card import-panel">
          <b>Import preview</b>
          <div>
            {report.result.counts.create} to create, {report.result.counts.update} to update, {report.result.counts.skip} duplicates skipped, {report.result.errors.length} error(s).
          </div>
          {report.result.errors.length > 0 && (
            <table>
              <thead><tr><th>Row</th><th>Problem</th></tr></thead>
              <tbody>{report.result.errors.map((er, i) => <tr key={i}><td>{er.row}</td><td>{er.message}</td></tr>)}</tbody>
            </table>
          )}
          {report.result.rows.some(r => r.warnings.length) && (
            <table>
              <thead><tr><th>Row</th><th>Action</th><th>Title</th><th>Warnings</th></tr></thead>
              <tbody>
                {report.result.rows.filter(r => r.warnings.length).map(r => (
                  <tr key={r.row}><td>{r.row}</td><td>{r.action}</td><td>{r.title}</td><td>{r.warnings.join(' ')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn pri" disabled={busy || report.result.errors.length > 0 || (report.result.counts.create + report.result.counts.update) === 0} onClick={confirmImport}>
              Confirm import ({report.result.counts.create + report.result.counts.update})
            </button>
            <button className="btn" disabled={busy} onClick={() => setReport(null)}>Cancel</button>
          </div>
          <div className="muted">Imported bookings default to Confirmed + Public unless the sheet says otherwise. Times are Australia/Sydney.</div>
        </div>
      )}

      <div className="wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Event</th><th>Department</th><th>Venue</th><th>Status</th><th>Visibility</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map(e => (
              <tr key={e.id}>
                <td className="dt-cell">{new Date(e.startAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}
                  <div className="h-sub">{hijriLabel(e.startAt, hijriOverrides)}</div>
                </td>
                <td>{fmtTime(e.startAt)}–{fmtTime(e.endAt)}</td>
                <td>{e.title}{e.hasConflict && <span className="conflict-badge">overlap</span>}</td>
                <td>{e.masked ? '—' : e.departmentName || departments.find(d => d.id === e.departmentId)?.name || e.departmentId}</td>
                <td>{e.venueName || venues.find(v => v.id === e.venueId)?.name || e.venueId}</td>
                <td><span className={`tag st-${e.status}`}>{e.status}</span></td>
                <td>{e.masked ? '—' : (e.visibility || 'private')}</td>
                <td><button className="btn" onClick={() => setModal({ editing: e })}>{isAdmin ? 'Review' : 'View'}</button></td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={8} className="muted">No bookings to show.</td></tr>}
          </tbody>
        </table>
      </div>
      {modal && (
        <BookingModal
          open={true} onClose={() => setModal(null)}
          venues={venues} departments={departments}
          editing={modal.editing} isAdmin={isAdmin} hijriOverrides={hijriOverrides}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false });
}
