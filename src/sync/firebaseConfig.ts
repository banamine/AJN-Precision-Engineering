/* Public Firebase web identifiers (NOT secrets — they ship in every browser bundle; access is enforced by Firestore rules + sign-in).
 * Project long-terminal-7txfk, dedicated database for this app. Never put a service-account JSON or private key anywhere in this repo. */
export const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyAe2jVnsu-9ixyajQ_9hOLYs0C3fnKaMb0',
  authDomain: 'long-terminal-7txfk.firebaseapp.com',
  projectId: 'long-terminal-7txfk',
  storageBucket: 'long-terminal-7txfk.firebasestorage.app',
  messagingSenderId: '382115576551',
  appId: '1:382115576551:web:bba26aa9ac0cdd07228042',
} as const;
export const FIRESTORE_DATABASE_ID = 'app-b03639af';
