import { withLiveConflicts } from '../utils/conflictUtils.js';
import { useEffect, useMemo, useState } from 'react';
import { HIJRI_MONTHS } from '../services/hijriService.js';
import { dateKeyInOrgTz, timeKeyInOrgTz } from '../utils/dateUtils.js';
import {
  DOW,
  buildGregorianMonthGrid,
  buildHijriMonthGrid,
  gregorianCursorToHijri,
  hijriCursorToGregorian,
  shiftGregorianCursor,
  shiftHijriCursor
} from '../utils/hijriCalendarGrid.js';
import BookingModal from '../components/BookingModal.jsx';

export default function CalendarPage({ events: rawEvents, venues, departments, isAdmin, hijriOverrides, onSaved }) {
  const events = useMemo(() => withLiveConflicts(rawEvents, venues, isAdmin), [rawEvents, venues, isAdmin]);
  // Which calendar drives month navigation / in-cell day numbering. Weekday
  // columns/labels are identical regardless of this choice.
  const [primary, setPrimary] = useState('gregorian'); // 'gregorian' | 'hijri'
  const [gCursor, setGCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [hCursor, setHCursor] = useState(() => gregorianCursorToHijri(gCursor.year, gCursor.month, hijriOverrides));
  const [deptFilter, setDeptFilter] = useState(() => new Set(departments.map(d => d.id)));
  const [venueFilter, setVenueFilter] = useState('');
  const [modal, setModal] = useState(null); // { editing } | { newOnDate }

  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    setDeptFilter(prev => {
      const next = new Set(prev);
      departments.forEach(d => { if (!next.has(d.id) && !prev.size) next.add(d.id); });
      return prev.size ? prev : new Set(departments.map(d => d.id));
    });
  }, [departments]);

  const shown = useMemo(() => events.filter(e =>
    e.status !== 'cancelled' &&
    (e.masked || !deptFilter.size || deptFilter.has(e.departmentId)) &&
    (!venueFilter || e.venueId === venueFilter)
  ), [events, deptFilter, venueFilter]);

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

  // Build the primary grid from its own calendar outward (not by relabeling
  // the other calendar's fixed month), so Hijri-primary navigation correctly
  // follows variable 29/30-day months and moon-sighting overrides.
  const grid = useMemo(() => (
    primary === 'hijri'
      ? buildHijriMonthGrid(hCursor.hYear, hCursor.hMonth, hijriOverrides)
      : buildGregorianMonthGrid(gCursor.year, gCursor.month, hijriOverrides)
  ), [primary, gCursor, hCursor, hijriOverrides]);

  const secondaryLabel = useMemo(() => {
    const inMonth = grid.cells.filter(c => c.inMonth);
    if (!inMonth.length) return '';
    if (primary === 'hijri') {
      const a = inMonth[0].date, b = inMonth[inMonth.length - 1].date;
      const af = a.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      const bf = b.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return af === bf ? af : `${af} – ${bf}`;
    }
    const a = inMonth[0].hijri, b = inMonth[inMonth.length - 1].hijri;
    if (!a.year || !b.year) return '';
    const an = HIJRI_MONTHS.find(m => m.value === a.month)?.name || '';
    const bn = HIJRI_MONTHS.find(m => m.value === b.month)?.name || '';
    return a.month === b.month && a.year === b.year ? `${an} ${a.year} AH` : `${an} ${a.year} – ${bn} ${b.year} AH`;
  }, [grid, primary]);

  const monthKeys = useMemo(() => new Set(grid.cells.filter(c => c.inMonth).map(c => c.key)), [grid]);
  const monthEvents = useMemo(() => shown.filter(e => monthKeys.has(dateKeyInOrgTz(e.startAt))), [shown, monthKeys]);

  function toggleDept(id) {
    setDeptFilter(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function goToday() {
    const d = new Date();
    const g = { year: d.getFullYear(), month: d.getMonth() };
    setGCursor(g);
    setHCursor(gregorianCursorToHijri(g.year, g.month, hijriOverrides));
  }

  function shift(delta) {
    if (primary === 'hijri') setHCursor(c => shiftHijriCursor(c, delta));
    else setGCursor(c => shiftGregorianCursor(c, delta));
  }

  function setPrimaryCalendar(next) {
    if (next === primary) return;
    if (next === 'hijri') setHCursor(gregorianCursorToHijri(gCursor.year, gCursor.month, hijriOverrides));
    else setGCursor(hijriCursorToGregorian(hCursor.hYear, hCursor.hMonth, hijriOverrides));
    setPrimary(next);
  }

  return (
    <section>
      <div className="stats">
        <div className="stat"><b>{monthEvents.length}</b>events this month</div>
        <div className="stat"><b>{monthEvents.filter(e => e.status === 'confirmed').length}</b>confirmed</div>
        <div className="stat"><b>{events.filter(e => e.status === 'pending').length}</b>awaiting approval</div>
        {isAdmin && <div className="stat"><b>{events.filter(e => e.hasConflict && e.status === 'pending').length}</b>pending with conflicts</div>}
      </div>

      <div className="bar">
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <strong className={`cal-title ${primary === 'hijri' ? 'dt-h' : 'dt-g'}`} style={{ minWidth: 200, textAlign: 'center' }}>
          {grid.label}
          {secondaryLabel && <div className={`h-sub ${primary === 'hijri' ? 'dt-g' : 'dt-h'}`}>{secondaryLabel}</div>}
        </strong>
        <button className="btn" onClick={() => shift(1)}>›</button>
        <button className="btn" onClick={goToday}>Today</button>
        <span className="sp" />
        <div className="seg" role="group" aria-label="Primary calendar">
          <button type="button" className={`seg-btn ${primary === 'gregorian' ? 'on' : ''}`} onClick={() => setPrimaryCalendar('gregorian')}>Gregorian</button>
          <button type="button" className={`seg-btn ${primary === 'hijri' ? 'on' : ''}`} onClick={() => setPrimaryCalendar('hijri')}>Hijri</button>
        </div>
        <select className="btn" value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="btn pri" onClick={() => setModal({ editing: null, newOnDate: todayKey })}>+ New booking</button>
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
        {grid.cells.map((cell) => {
          const list = byDay.get(cell.key) || [];
          const deptColor = (deptId) => departments.find(d => d.id === deptId)?.colorHex || '#2563eb';
          const mainNumber = primary === 'hijri' ? cell.hijri.day : cell.date.getDate();
          const showMonthName = primary === 'hijri' ? cell.hijri.day === 1 : cell.date.getDate() === 1;
          const subLabel = primary === 'hijri'
            ? `${cell.date.getDate()}${showMonthName ? ' ' + cell.date.toLocaleDateString('en-AU', { month: 'short' }) : ''}`
            : (cell.hijri.year ? `${cell.hijri.day}${showMonthName ? ' ' + (HIJRI_MONTHS.find(m => m.value === cell.hijri.month)?.name || '') : ''}` : '');
          return (
            <div key={cell.key} className={`cell ${!cell.inMonth ? 'out' : ''}             ${cell.key === todayKey ? 'today' : ''} ${cell.key === selectedKey ? 'selected' : ''}`}
                          onClick={() => { setSelectedKey(cell.key); setModal({ editing: null, newOnDate: cell.key }); }}>
                          <div className="cell-head"><span className={`n ${primary === 'hijri' ? 'dt-h' : 'dt-g'}`}>{mainNumber}</span>
                          {subLabel ? <span className={`h-sub ${primary === 'hijri' ? 'dt-g' : 'dt-h'}`}>{subLabel}</span> : null}</div>
              {list.slice(0, 3).map(e => (
                <button key={e.id} className={`ev ${e.status === 'pending' ? 'pend' : ''} ${e.masked && e.status !== 'pending' ? 'priv' : ''} ${e.hasConflict ? 'conflict' : ''}`}
                  style={e.masked ? undefined : { background: deptColor(e.departmentId) }}
                  title={`${e.title} · ${e.venueName || e.venueId}${e.hasConflict ? ' · overlaps another booking' : ''}`}
                  onClick={(ev) => { ev.stopPropagation(); setModal({ editing: e }); }}>
                  {e.dateBasis === 'hijri' ? '☾ ' : ''}{timeKeyInOrgTz(e.startAt)} {e.title}
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
