import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/firebase';

/** Admin-only live view of the most recent audit log entries. */
export function watchAuditLog(callback, max = 200) {
  const q = query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
