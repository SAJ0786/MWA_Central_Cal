// Firebase configuration is read from Vite env vars (see .env.example).
// Never hard-code real project credentials here — this file is committed.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

export const ORG_TIMEZONE = import.meta.env.VITE_ORG_TIMEZONE || 'Australia/Sydney';
export const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'australia-southeast1';
