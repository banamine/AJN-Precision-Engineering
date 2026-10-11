// Runs the REAL Firestore backend (src/sync/cloudBackend.ts) against the local Firestore emulator with the DEPLOYED rules.
// Start the emulator first:  npx firebase emulators:start --only firestore --project demo-ajn   (port 8089 via firebase.json)
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createFirestoreBackend } from '../../src/sync/cloudBackend.ts';
import { syncOnce } from '../../src/sync/syncEngine.ts';

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`; // identical to the rules read back from the console for database app-b03639af
const modular = (db: any) => (db?._delegate ?? db);

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-ajn', firestore: { host: '127.0.0.1', port: 8089, rules: RULES } });
  await env.clearFirestore();
  const dbA = modular(env.authenticatedContext('alice').firestore());
  const dbA2 = modular(env.authenticatedContext('alice').firestore()); // "second device", same account
  const dbBob = modular(env.authenticatedContext('bob').firestore());
  const anon = modular(env.unauthenticatedContext().firestore());
  const media = (k: string) => ({ src: `https://archive.org/download/${k}.mp4`, title: k, mediaType: 'video' as const });
  const base = { favorites: [], favTombs: {}, history: [], histTombs: {}, historyClearedAt: 0 };
  const NOW = Date.now();

  // rules
  await assertFails(getDoc(doc(anon, 'users/alice/favorites/x')));
  await assertFails(getDoc(doc(dbBob, 'users/alice/favorites/x')));
  await assertFails(setDoc(doc(dbBob, 'users/alice/favorites/x'), { a: 1 }));
  await assertSucceeds(setDoc(doc(dbA, 'users/alice/favorites/probe'), { a: 1 }));
  await assertFails(setDoc(doc(dbA, 'other/alice'), { a: 1 }));
  console.log('PASS rules: owner-only read/write; anonymous, other user and non-user paths refused');

  // real backend, two devices, same account
  const bA = createFirestoreBackend(dbA, 'alice'), bA2 = createFirestoreBackend(dbA2, 'alice');
  const fav = { ...media('classic-ep1'), id: 'https://archive.org/download/x/The Odd Couple S01E01.mp4?a=b&c=d#frag', savedAt: NOW - 1000 };
  let d1 = await syncOnce(bA, { ...base, favorites: [fav], history: [{ ...media('h1'), id: 'h1', playedAt: NOW, updatedAt: NOW, progressSeconds: 77, plays: 1, restoredPaused: undefined } as any], syncHistory: true }, NOW);
  assert.equal(d1.stats.favPushed, 1); assert.equal(d1.stats.histPushed, 1);
  let d2 = await syncOnce(bA2, { ...base, syncHistory: true }, NOW + 10);
  assert.equal(d2.favorites[0]?.id, fav.id, 'URL-shaped id with / ? & # survives the round trip'); assert.equal(d2.history[0]?.progressSeconds, 77);
  console.log('PASS real backend: favorite + history round-trip between two devices');
  d2 = await syncOnce(bA2, { ...d2, favorites: [], favTombs: { [fav.id]: NOW + 100 } }, NOW + 100);
  d1 = await syncOnce(bA, d1 as any, NOW + 200); assert.deepEqual(d1.favorites, []); console.log('PASS real backend: removal propagates');
  d2 = await syncOnce(bA2, { ...d2, history: [], histTombs: {}, historyClearedAt: NOW + 300 }, NOW + 300);
  d1 = await syncOnce(bA, d1 as any, NOW + 400); assert.deepEqual(d1.history, []); console.log('PASS real backend: Clear history propagates');
  const bob = createFirestoreBackend(dbBob, 'bob'); const bobRes = await syncOnce(bob, { ...base, syncHistory: true }, NOW); assert.deepEqual(bobRes.favorites, []);
  await assert.rejects(createFirestoreBackend(dbBob, 'alice').listFavorites(), /permission|PERMISSION/i); console.log("PASS real backend: Bob cannot read Alice's data");
  // undefined fields (optional media props) don't break writes; a 450-item batch chunks correctly
  const many = Array.from({ length: 450 }, (_, i) => ({ ...media('m' + i), id: 'm' + i, savedAt: NOW + i, thumbnailUrl: undefined }));
  const big = await syncOnce(bA, { ...base, favorites: many, syncHistory: false }, NOW + 1000); assert.equal(big.favorites.length, 200, 'capped at the 200-favorite limit'); assert.equal(big.stats.favOverLimit, true);
  console.log('PASS real backend: 450 items with undefined fields written in chunks, capped at 200 locally');
  await env.cleanup(); console.log('emulator check: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
