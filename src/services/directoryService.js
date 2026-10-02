import {
  collection, doc, onSnapshot, orderBy, query,
  addDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase/firebase';

export function watchVenues(callback) {
  const q = query(collection(db, 'venues'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function watchDepartments(callback) {
  const q = query(collection(db, 'departments'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function createVenue(data) {
  return addDoc(collection(db, 'venues'), {
    name: data.name,
    capacity: Number(data.capacity) || null,
    hireable: data.hireable !== false,
    openingHours: data.openingHours || '',
    bufferMinutes: Number(data.bufferMinutes) || 0,
    active: data.active !== false
  });
}

export async function updateVenue(id, data) {
  return updateDoc(doc(db, 'venues', id), data);
}

export async function deleteVenue(id) {
  return deleteDoc(doc(db, 'venues', id));
}

export async function createDepartment(data) {
  return addDoc(collection(db, 'departments'), {
    name: data.name,
    colorHex: data.colorHex || '#2563eb',
    approvalRequired: data.approvalRequired !== false,
    active: data.active !== false
  });
}

export async function updateDepartment(id, data) {
  return updateDoc(doc(db, 'departments', id), data);
}

export async function deleteDepartment(id) {
  return deleteDoc(doc(db, 'departments', id));
}
