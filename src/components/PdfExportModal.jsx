import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildPdfModel, GREGORIAN_MONTH_NAMES, PDF_HIJRI_MONTH_OPTIONS } from '../services/pdfModel.js';

const PUBLIC_DEPARTMENT_NAME = 'MWA Programs';

export default function PdfExportModal({ events, venues, departments, isAdmin, overrides, initial, onClose }) {
  const [basis, setBasis] = useState(initial.basis);
  const [gYear, setGYear] = useState(initial.gCursor.year);
  const [gMonth, setGMonth] = useState(initial.gCursor.month);
  const [hYear, setHYear] = useState(initial.hCursor.hYear);
  const [hMonth, setHMonth] = useState(initial.hCursor.hMonth);
  // Public visitors can only print the MWA Programs calendar, across all venues.
  const publicDept = useMemo(() => departments.find(d => d.name.trim().toLowerCase() === PUBLIC_DEPARTMENT_NAME.toLowerCase()), [departments]);
  const [deptIds, setDeptIds] = useState(() => (isAdmin ? new Set(initial.deptFilter) : new Set(publicDept ? [publicDept.id] : [])));
  const [venueId, setVenueId] = useState(isAdmin ? (initial.venueFilter || '') : '');
  const [includePending, setIncludePending] = useState(false);
  const [publicOnly, setPublicOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const yearOk = basis === 'hijri' ? hYear >= 1300 && hYear <= 1600 : gYear >= 1900 && gYear <= 2200;

  const filtered = useMemo(() => events.filter(e =>
    !e.masked &&
    (e.status === 'confirmed' || (isAdmin && includePending && e.status === 'pending')) &&
    (!isAdmin || !publicOnly || e.visibility === 'public' || e.departmentId === publicDept?.id) &&
    (isAdmin ? (!e.departmentId || deptIds.has(e.departmentId)) : (!!publicDept && e.departmentId === publicDept.id)) &&
    (!isAdmin || !venueId || e.venueId === venueId)
  ), [events, isAdmin, includePending, publicOnly, deptIds, venueId, publicDept]);

  const model = useMemo(() => {
    if (!yearOk) return null;
    try {
      return buildPdfModel({ events: filtered, basis, year: gYear, month: gMonth, hYear, hMonth, overrides });
    } catch { return null; }
  }, [filtered, basis, gYear, gMonth, hYear, hMonth, overrides, yearOk]);

  function toggleDept(id) {
    setDeptIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function download() {
    if (!model) return;
    setBusy(true); setErr('');
    try {
      const { renderCalendarPdf, pdfFilename } = await import('../services/pdfCalendar.js');
      await renderCalendarPdf(model, pdfFilename(model));
      onClose();
    } catch (e) {
      setErr(`Couldn't create the PDF: ${e.message || e}`);
    } finally { setBusy(false); }
  }

  return createPortal(
    <div className="overlay show" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="pdf-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button>
        <h3 id="pdf-title" style={{ paddingRight: 36 }}>Download monthly calendar (PDF)</h3>

        <label>Calendar month</label>
        <div className="segmented" role="group" aria-label="Month basis" style={{ marginBottom: 8 }}>
          {['gregorian', 'hijri'].map(b => (
            <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>{b === 'hijri' ? 'Hijri month' : 'Gregorian month'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {basis === 'gregorian' ? (
            <>
              <select aria-label="Month" value={gMonth} onChange={e => setGMonth(+e.target.value)} style={{ flex: 2 }}>
                {GREGORIAN_MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
              <input aria-label="Year" type="number" value={gYear} onChange={e => setGYear(+e.target.value)} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <select aria-label="Hijri month" value={hMonth} onChange={e => setHMonth(+e.target.value)} style={{ flex: 2 }}>
                {PDF_HIJRI_MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
              </select>
              <input aria-label="Hijri year" type="number" value={hYear} onChange={e => setHYear(+e.target.value)} style={{ flex: 1 }} />
            </>
          )}
        </div>
        {!yearOk && <div className="err" role="alert">Enter a valid year.</div>}

        {isAdmin && (<>
        <label style={{ marginTop: 12 }}>Event types (departments)</label>
        <div className="dept-chips" style={{ margin: '4px 0 8px' }}>
          {departments.map(d => (
            <button key={d.id} type="button" className="chip" onClick={() => toggleDept(d.id)}
              style={{ borderColor: d.colorHex, background: deptIds.has(d.id) ? d.colorHex : 'transparent', color: deptIds.has(d.id) ? '#fff' : d.colorHex }}>{d.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button type="button" className="btn" onClick={() => setDeptIds(new Set(departments.map(d => d.id)))}>All</button>
          <button type="button" className="btn" onClick={() => setDeptIds(new Set())}>None</button>
        </div>

        <label>Venue</label>
        <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        </>)}
        {!isAdmin && <p className="muted" style={{ marginTop: 12 }}>This calendar lists confirmed {PUBLIC_DEPARTMENT_NAME} events at all venues.</p>}

        {isAdmin && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={publicOnly} onChange={e => setPublicOnly(e.target.checked)} style={{ width: 'auto' }} /> Public events only (recommended for printing)
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={includePending} onChange={e => setIncludePending(e.target.checked)} style={{ width: 'auto' }} /> Include pending requests
            </label>
          </div>
        )}

        <p className="muted" style={{ marginTop: 12 }}>
          {model ? `${model.eventCount} event(s) in ${model.footerLabel}. Only confirmed events are listed.` : 'Choose a month.'}
        </p>
        {err && <div className="err" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn pri" disabled={busy || !model} onClick={download}>{busy ? 'Creating PDF…' : 'Download PDF'}</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
