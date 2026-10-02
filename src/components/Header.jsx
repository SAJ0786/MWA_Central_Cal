import { useAuth } from '../contexts/AuthContext.jsx';

export default function Header({ tab, setTab }) {
  const { user, isAdmin, logout } = useAuth();
  return (
    <header>
      <h1>📅 MWA Central Calendar</h1>
      <nav>
        <button className={`tab ${tab === 'calendar' ? 'on' : ''}`} onClick={() => setTab('calendar')}>Calendar</button>
        <button className={`tab ${tab === 'bookings' ? 'on' : ''}`} onClick={() => setTab('bookings')}>Bookings</button>
        <button className={`tab ${tab === 'admin' ? 'on' : ''}`} onClick={() => setTab('admin')}>
          {isAdmin ? 'Admin' : 'Admin sign in'}
        </button>
      </nav>
      {user && isAdmin ? (
        <span className="muted">
          {user.email} &middot; <button className="btn" onClick={logout}>Sign out</button>
        </span>
      ) : <span className="muted">Viewing as public visitor</span>}
    </header>
  );
}
