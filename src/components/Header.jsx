import { CalendarDays, Plus, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Header({ tab, setTab, onNewBooking }) {
  const { user, isAdmin, logout } = useAuth();
  const navBtn = (id, label) => (
    <button type="button" className={`lb lb-nav ${tab === id ? 'nav-active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>
  );
  return (
    <header className="app-header glass-panel">
      <button type="button" className="brand" onClick={() => setTab('calendar')} aria-label="MWA Central Calendar home">
        <span className="brand-mark"><CalendarDays size={19} /></span>
        <span><strong>MWA Central</strong><small>Calendar</small></span>
      </button>
      <nav aria-label="Main navigation">
        {navBtn('calendar', 'Calendar')}
        {navBtn('bookings', 'Bookings')}
        {isAdmin && navBtn('admin', 'Admin')}
      </nav>
      <div className="header-actions">
        <button type="button" className="lb lb-default" onClick={onNewBooking}><Plus />New booking</button>
        {user && isAdmin ? (
          <>
            <span className="visitor" title={user.email}><span /><span className="admin-email">{user.email}</span></span>
            <button type="button" className="lb lb-outline" onClick={logout}><LogOut />Sign out</button>
          </>
        ) : (
          <>
            <button type="button" className={`lb lb-outline ${tab === 'admin' ? 'nav-active' : ''}`} onClick={() => setTab('admin')}><ShieldCheck />Admin sign in</button>
            <span className="visitor" title="Viewing as a public visitor"><span />Public visitor</span>
          </>
        )}
      </div>
    </header>
  );
}