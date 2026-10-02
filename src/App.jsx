import { useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext.jsx';
import { firebaseConfigured } from './firebase/firebase.js';
import { watchVenues, watchDepartments } from './services/directoryService.js';
import { watchAllEvents, fetchPublicEvents } from './services/eventsService.js';
import { getHijriSettings } from './services/calendarSettingsService.js';
import Header from './components/Header.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import BookingsPage from './pages/BookingsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('calendar');
  const [venues, setVenues] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [events, setEvents] = useState([]);
  const [hijriOverrides, setHijriOverrides] = useState([]);
  const [publicLoadTick, setPublicLoadTick] = useState(0);

  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    const unsubV = watchVenues(setVenues);
    const unsubD = watchDepartments(setDepartments);
    return () => { unsubV(); unsubD(); };
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    getHijriSettings().then(s => setHijriOverrides(s.overrides || []));
  }, []);

  // Admin: realtime full collection. Public: fetch sanitized events via a
  // Cloud Function (no direct Firestore access) and refetch on demand.
  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    if (isAdmin) {
      return watchAllEvents(setEvents, () => setEvents([]));
    }
    let cancelled = false;
    fetchPublicEvents().then(list => { if (!cancelled) setEvents(list); }).catch(() => setEvents([]));
    return () => { cancelled = true; };
  }, [isAdmin, publicLoadTick]);

  const reloadPublic = () => setPublicLoadTick(t => t + 1);

  if (!firebaseConfigured) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 20 }}>
        <h1>Community Hub Calendar</h1>
        <p>
          Firebase is not configured yet. Copy <code>.env.example</code> to <code>.env</code>,
          fill in your Firebase project's web app credentials, and restart the dev server.
          See <code>docs/SETUP.md</code> for the full checklist.
        </p>
      </div>
    );
  }

  return (
    <>
      <Header tab={tab} setTab={setTab} />
      <main>
        {tab === 'calendar' && (
          <CalendarPage events={events} venues={venues} departments={departments}
            isAdmin={isAdmin} hijriOverrides={hijriOverrides} onSaved={reloadPublic} />
        )}
        {tab === 'bookings' && (
          <BookingsPage events={events} venues={venues} departments={departments}
            isAdmin={isAdmin} hijriOverrides={hijriOverrides} onSaved={reloadPublic} />
        )}
        {tab === 'admin' && (
          <AdminPage events={events} venues={venues} departments={departments}
            hijriOverrides={hijriOverrides} onSaved={reloadPublic}
            onReloadSettings={() => getHijriSettings().then(s => setHijriOverrides(s.overrides || []))} />
        )}
      </main>
    </>
  );
}
