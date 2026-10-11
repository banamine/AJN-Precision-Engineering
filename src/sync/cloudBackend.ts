/* Firestore implementation of CloudBackend. Layout (all under the signed-in user, matching the deployed rules `users/{uid}/**`):
 *   users/{uid}/favorites/{docIdFor(itemId)}   item fields + savedAt + updatedAt (+ deleted:true for a removal tombstone)
 *   users/{uid}/history/{docIdFor(itemId)}     same, plus plays/playedAt/progressSeconds
 *   users/{uid}/meta/history                   { clearedAt }
 * This is the ONLY module that imports the Firebase SDK, and it imports app/auth/firestore statically, so they always come from one
 * module graph. (Mixing static and separate dynamic imports of firebase/* let the dev server load two copies, which fails with
 * "Component auth has not been registered yet".) Callers load THIS module with a single dynamic import(), so people who never
 * sign in never download the SDK. */
import { getApps, getApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { getFirestore, writeBatch, doc, getDocs, getDoc, setDoc, collection, type Firestore } from 'firebase/firestore';
import type { CloudBackend } from './syncEngine';
import { docIdFor, type RemoteFav, type RemoteHist } from './syncMerge';
import { FIREBASE_WEB_CONFIG, FIRESTORE_DATABASE_ID } from './firebaseConfig';

export interface SyncUser { uid: string; email: string | null; name: string | null }
export interface FirebaseHandles { auth: Auth; db: Firestore }

const APP_NAME = 'ajn-sync'; // own named app: never collides with a default app another module (e.g. AI Studio's src/firebase.ts) may create
let handles: FirebaseHandles | null = null;
export function getFirebase(): FirebaseHandles {
  if (!handles) {
    const app: FirebaseApp = getApps().some((a) => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(FIREBASE_WEB_CONFIG, APP_NAME);
    handles = { auth: getAuth(app), db: getFirestore(app, FIRESTORE_DATABASE_ID) };
  }
  return handles;
}
export const watchAuth = (cb: (u: User | null) => void, onErr: (e: unknown) => void) => onAuthStateChanged(getFirebase().auth, cb, onErr);
export const signInWithGoogle = () => signInWithPopup(getFirebase().auth, new GoogleAuthProvider());
export const signOutUser = () => signOut(getFirebase().auth);
export const currentUser = () => getFirebase().auth.currentUser;

export function describeAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/unauthorized-domain': return `This site's domain isn't authorized for Google sign-in yet. In the Firebase console go to Authentication → Settings → Authorized domains and add ${typeof location !== 'undefined' ? location.hostname : 'this domain'}.`;
    case 'auth/popup-blocked': return 'The sign-in popup was blocked. Allow popups for this site and try again.';
    case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return 'Sign-in was cancelled.';
    case 'auth/network-request-failed': return 'Network error while signing in.';
    case 'permission-denied': return 'Cloud storage refused the request (security rules). Sign out and in again; if it persists the rules need checking.';
    case 'resource-exhausted': return 'Cloud storage quota is used up for now (shared AI Studio quota). Your data is safe on this device; try again later.';
    default: return `${code || 'Error'}: ${(e as Error)?.message ?? String(e)}`.slice(0, 240);
  }
}

const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o)); // Firestore rejects `undefined` fields
const CHUNK = 400; // writeBatch limit is 500

export function createFirestoreBackend(db: Firestore, uid: string): CloudBackend {
  const put = async (sub: 'favorites' | 'history', docs: Array<{ id: string }>) => {
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + CHUNK)) batch.set(doc(db, 'users', uid, sub, docIdFor(d.id)), clean(d));
      await batch.commit();
    }
  };
  const list = async <T,>(sub: string): Promise<T[]> => { return (await getDocs(collection(db, 'users', uid, sub))).docs.map((d) => d.data() as T); };
  return {
    listFavorites: () => list<RemoteFav>('favorites'),
    putFavorites: (docs) => put('favorites', docs),
    listHistory: () => list<RemoteHist>('history'),
    putHistory: (docs) => put('history', docs),
    async deleteHistory(ids) {
      for (let i = 0; i < ids.length; i += CHUNK) { const b = writeBatch(db); for (const id of ids.slice(i, i + CHUNK)) b.delete(doc(db, 'users', uid, 'history', docIdFor(id))); await b.commit(); }
    },
    async getHistoryClearedAt() { const s = await getDoc(doc(db, 'users', uid, 'meta', 'history')); const v = s.exists() ? s.data().clearedAt : 0; return typeof v === 'number' ? v : 0; },
    async setHistoryClearedAt(ts) { await setDoc(doc(db, 'users', uid, 'meta', 'history'), { clearedAt: ts }); },
  };
}
