import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '../firebase/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null); // users/{uid} doc, has .role
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubAuth;
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

  const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const logout = () => signOut(auth);
  const isAdmin = profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
