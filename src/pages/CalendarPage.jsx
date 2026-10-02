import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS, getHijriParts } from '../services/hijriService.js';
import { dateKeyInOrgTz } from '../utils/dateUtils.js';
import BookingModal from '../components/BookingModal.jsx';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage({ events, venues, departments, isAdmin, hijriOverrides, onSaved }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showHijri, setShowHijri] = useState(true);
  const [deptFilter, setDeptFilter] = useState(() => new Set(departments.map(d => d.id)));
  const [venueFilter, setVenueFilter] = useState('');
  const [modal, setModal] = useState(null); // { editing } | { newOnDate }

  useEffect(() => {
    setDeptFilter(prev => {
      const next = new Set(prev);
      departments.forEach(d => { if (!next.has(d.id) && !prev.size) next.add(d.id); });
      return prev.size ? prev : new Set(departments.map(d => d.id));
    });
  }, [departments]);

  const shown = useMemo(() => events.filter(e =>
    e.status !== 'cancelled' &&
    (!deptFilter.size || deptFilter.has(e.departmentId)) &&
    (!venueFilter || e.venueId === venueFilter)
  ), [events, deptFilter, venueFilter]);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const todayKey = dateKeyInOrgTz(new Date().toISOString());

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of shown) {
      const key = dateKeyInOrgTz(e.startAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [shown]);

  const monthHijriRange = useMemo(() => {
    const a = getHijriParts(dateKeyFromParts(year, month, 1), hijriOverrides);
    const b = getHijriParts(dateKeyFromParts(year, month, daysInMonth), hijriOverrides);
    if (!a.year || !b.year) return '';
    const an = HIJRI_MONTHS.find(m => m.value === a.month)?.name || '';
    const bn = HIJRI_MONTHS.find(m => m.value === b.month)?.name || '';
    return a.month === b.month && a.year === b.year ? `${an} ${a.year}` : `${an} ${a.year} – ${bn} ${b.year}`;
  }, [year, month, daysInMonth, hijriOverrides]);

  function toggleDept(id) {
    setDeptFilter(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const monthEvents = shown.filter(e => {
    const k = dateKeyInOrgTz(e.startAt);
    return k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
  });

  return (
    <section>
      <div className="stats">
        <div className="stat"><b>{monthEvents.length}</b>events this month</div>
        <div className="stat"><b>{monthEvents.filter(e => e.status === 'confirmed').length}</b>confirmed</div>
        <div className="stat"><b>{events.filter(e => e.status === 'pending').length}</b>awaiting approval</div>
        <div className="stat"><b>{events.filter(e => e.hasConflict && e.status === 'pending').length}</b>pending with conflicts</div>
      </div>

      <div className="bar">
        <button className="btn" onClick={() => setCursor(c => shiftMonth(c, -1))}>‹</button>
        <strong style={{ minWidth: 160, textAlign: 'center' }}>
          {cursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
          {showHijri && monthHijriRange && <div className="h-sub">{monthHijriRange} AH</div>}
        </strong>
        <button className="btn" onClick={() => setCursor(c => shiftMonth(c, 1))}>›</button>
        <button className="btn" onClick={() => setCursor(() => { const d = new Date(); d.setDate(1); return d; })}>Today</button>
        <span className="sp" />
        <label className="btn"><input type="checkbox" style={{ width: 'auto' }} checked={showHijri} onChange={e => setShowHijri(e.target.checked)} /> Hijri</label>
        <select className="btn" value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="btn pri" onClick={() => setModal({ editing: null, newOnDate: dateKeyFromParts(year, month, new Date().getDate()) })}>+ New booking</button>
      </div>

      <div className="bar">
        {departments.map(d => (
          <button key={d.id} className="chip" onClick={() => toggleDept(d.id)}
            style={{
              borderColor: d.colorHex,
              background: deptFilter.has(d.id) ? d.colorHex : 'transparent',
              color: deptFilter.has(d.id) ? '#fff' : d.colorHex
            }}>{d.name}</button>
        ))}
      </div>

      <div className="grid">
        {DOW.map(d => <div key={d} className="dh">{d}</div>)}
        {Array.from({ length: totalCells }).map((_, i) => {
          const date = new Date(year, month, 1 - firstDow + i);
          const key = dateKeyInOrgTz(date.toISOString());
          const list = byDay.get(key) || [];
          const hp = showHijri ? getHijriParts(key, hijriOverrides) : null;
          const deptColor = (deptId) => departments.find(d => d.id === deptId)?.colorHex || '#2563eb';
          return (
            <div key={i} className={`cell ${date.getMonth() !== month ? 'out' : ''} ${key === todayKey ? 'today' : ''}`}
              onClick={() => setModal({ editing: null, newOnDate: key })}>
              <span className="n">{date.getDate()}</span>
              {hp && hp.year ? <span className="h-sub">{hp.day}{hp.day === 1 ? ' ' + HIJRI_MONTHS.find(m => m.value === hp.month)?.name : ''}</span> : null}
              {list.slice(0, 3).map(e => (
                <button key={e.id} className={`ev ${e.status === 'pending' ? 'pend' : ''} ${e.hasConflict ? 'conflict' : ''}`}
                  style={{ background: deptColor(e.departmentId) }}
                  title={`${e.title} · ${e.venueName || e.venueId}${e.hasConflict ? ' · overlaps another booking' : ''}`}
                  onClick={(ev) => { ev.stopPropagation(); setModal({ editing: e }); }}>
                  {e.dateBasis === 'h' ? '☾ ' : ''}{new Date(e.startAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })} {e.title}
                </button>
              ))}
              {list.length > 3 && <div className="more">+{list.length - 3} more</div>}
            </div>
          );
        })}
      </div>

      {modal && (
        <BookingModal
          open={true}
          onClose={() => setModal(null)}
          venues={venues}
          departments={departments}
          editing={modal.editing}
          initialDate={modal.newOnDate}
          isAdmin={isAdmin}
          hijriOverrides={hijriOverrides}
          onSaved={() => { onSaved(); }}
        />
      )}
    </section>
  );
}

function shiftMonth(d, delta) {
  const n = new Date(d);
  n.setMonth(n.getMonth() + delta);
  return n;
}

function dateKeyFromParts(y, m, d) {
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
