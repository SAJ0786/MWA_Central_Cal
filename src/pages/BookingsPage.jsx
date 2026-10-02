import { useMemo, useState } from 'react';
import { hijriLabel } from '../utils/dateUtils.js';
import { downloadCsv, downloadIcs } from '../services/exportService.js';
import BookingModal from '../components/BookingModal.jsx';

export default function BookingsPage({ events, venues, departments, isAdmin, hijriOverrides, onSaved }) {
  const [modal, setModal] = useState(null);
  const sorted = useMemo(() => [...events].sort((a, b) => a.startAt.localeCompare(b.startAt)), [events]);

  return (
    <section>
      <div className="bar">
        <span className="sp" />
        <button className="btn" onClick={() => downloadCsv(sorted)}>Export CSV</button>
        <button className="btn" onClick={() => downloadIcs(sorted.filter(e => e.status === 'confirmed'))}>Export iCal (.ics)</button>
      </div>
      <div className="wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Event</th><th>Department</th><th>Venue</th><th>Status</th><th>Visibility</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map(e => (
              <tr key={e.id}>
                <td>{new Date(e.startAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}
                  <div className="h-sub">{hijriLabel(e.startAt, hijriOverrides)}</div>
                </td>
                <td>{fmtTime(e.startAt)}–{fmtTime(e.endAt)}</td>
                <td>{e.title}{e.hasConflict && <span className="conflict-badge">overlap</span>}</td>
                <td>{e.departmentName || departments.find(d => d.id === e.departmentId)?.name || e.departmentId}</td>
                <td>{e.venueName || venues.find(v => v.id === e.venueId)?.name || e.venueId}</td>
                <td><span className={`tag st-${e.status}`}>{e.status}</span></td>
                <td>{e.visibility || 'private'}</td>
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
