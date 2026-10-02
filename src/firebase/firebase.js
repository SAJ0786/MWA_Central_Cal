import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { firebaseConfig, FUNCTIONS_REGION } from './firebaseConfig';

export const firebaseConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey.length > 10;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

setPersistence(auth, browserLocalPersistence).catch(() => {});

export default app;
