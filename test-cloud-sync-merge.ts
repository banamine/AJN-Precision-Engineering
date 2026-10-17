// Two simulated devices sharing one in-memory "cloud". Checks the sync rules the user specified.
import assert from 'node:assert/strict';
import { syncOnce, type CloudBackend, type SyncInput } from './src/sync/syncEngine.ts';
import { docIdFor, mergeFavorites, mergeHistory, CLOCK_SKEW_MS } from './src/sync/syncMerge.ts';
import { parseLocalState, capTombs, loadSyncSettings } from './src/sync/syncState.ts';
import type { FavoriteMedia } from './src/utils/mediaFavorites.ts';
import type { HistoryEntry } from './src/utils/historyStore.ts';

class FakeCloud implements CloudBackend {
  favs = new Map<string, any>(); hist = new Map<string, any>(); cleared = 0; writes = 0;
  async listFavorites() { return [...this.favs.values()].map((x) => structuredClone(x)); }
  async putFavorites(d: any[]) { d.forEach((x) => { this.writes++; this.favs.set(docIdFor(x.id), structuredClone(x)); }); }
  async listHistory() { return [...this.hist.values()].map((x) => structuredClone(x)); }
  async putHistory(d: any[]) { d.forEach((x) => { this.writes++; this.hist.set(docIdFor(x.id), structuredClone(x)); }); }
  async deleteHistory(ids: string[]) { ids.forEach((i) => this.hist.delete(docIdFor(i))); }
  async getHistoryClearedAt() { return this.cleared; }
  async setHistoryClearedAt(t: number) { this.cleared = t; }
}
const media = (k: string) => ({ src: `https://archive.org/download/${k}.mp4`, title: k, mediaType: 'video' as const });
const NOW = 1_800_000_000_000;
const fav = (id: string, ts: number): FavoriteMedia => ({ ...media(id), id, savedAt: ts });
const he = (id: string, o: Partial<HistoryEntry> = {}): HistoryEntry => ({ ...media(id), id, playedAt: NOW - 1000, updatedAt: NOW - 1000, progressSeconds: 0, plays: 1, ...o });
const dev = (o: Partial<SyncInput> = {}): SyncInput => ({ favorites: [], favTombs: {}, history: [], histTombs: {}, historyClearedAt: 0, syncHistory: false, ...o });

(async () => {
  // doc ids: safe, deterministic, distinct per VERSION of a show (audio vs classic) — never title based
  const idA = 'asset-aaa111', idB = 'https://archive.org/download/OTR/The%20Odd%20Couple.mp3';
  assert.match(docIdFor(idB), /^i[0-9a-f]+$/); assert.ok(!docIdFor(idB).includes('/'));
  assert.equal(docIdFor(idA), docIdFor(idA)); assert.notEqual(docIdFor(idA), docIdFor(idB));
  assert.ok(docIdFor('x'.repeat(5000)).length < 80, 'long URLs stay within Firestore id limits');

  // ── Favorites: add on A, appears on B; each version is its own favorite
  const cloud = new FakeCloud();
  let A = dev({ favorites: [fav('classic-ep1', NOW - 5000)] });
  let r = await syncOnce(cloud, A, NOW); A = r;
  assert.equal(r.stats.favPushed, 1);
  let B = await syncOnce(cloud, dev(), NOW + 1000);
  assert.deepEqual(B.favorites.map((f) => f.id), ['classic-ep1'], 'B receives A\'s favorite');
  assert.equal(B.stats.favPushed, 0, 'pulled data is not re-pushed');
  // favoriting the AUDIO version on B does not favorite anything else
  B = await syncOnce(cloud, { ...B, favorites: [fav('audio-ep1', NOW + 2000), ...B.favorites] }, NOW + 3000);
  A = await syncOnce(cloud, A, NOW + 4000);
  assert.deepEqual(A.favorites.map((f) => f.id).sort(), ['audio-ep1', 'classic-ep1']);
  assert.equal(new Set(A.favorites.map((f) => f.id)).size, 2, 'two versions stay two distinct favorites');

  // ── removal syncs (tombstone), and does not come back
  A = await syncOnce(cloud, { ...A, favorites: A.favorites.filter((f) => f.id !== 'classic-ep1'), favTombs: { ...A.favTombs, 'classic-ep1': NOW + 5000 } }, NOW + 5000);
  B = await syncOnce(cloud, B, NOW + 6000);
  assert.deepEqual(B.favorites.map((f) => f.id), ['audio-ep1'], 'removal propagated');
  assert.ok(B.favTombs['classic-ep1'], 'tombstone kept so it stays removed');
  B = await syncOnce(cloud, B, NOW + 7000); assert.deepEqual(B.favorites.map((f) => f.id), ['audio-ep1'], 'still removed after another round');
  // re-add later beats the old tombstone
  A = await syncOnce(cloud, { ...A, favorites: [fav('classic-ep1', NOW + 8000), ...A.favorites], favTombs: {} }, NOW + 8000);
  B = await syncOnce(cloud, B, NOW + 9000); assert.ok(B.favorites.some((f) => f.id === 'classic-ep1'), 're-favorite after removal wins');
  // remove on a device that is offline while another re-adds: newest timestamp wins both ways
  const m1 = mergeFavorites([fav('z', 100)], {}, [{ ...fav('z', 100), updatedAt: 200, deleted: true }], 1000);
  assert.deepEqual(m1.list, []); assert.equal(m1.push.length, 0, 'older local add loses to newer remote removal');
  const m2 = mergeFavorites([], { z: 300 }, [{ ...fav('z', 100), updatedAt: 200 }], 1000);
  assert.deepEqual(m2.list, []); assert.equal(m2.push.length, 1, 'newer local removal is pushed');
  const m3 = mergeFavorites([fav('z', 500)], { z: 500 }, [], 1000); assert.deepEqual(m3.list, [], 'equal timestamps: removal wins');
  // junk in the cloud is ignored, not rendered
  const junk = [{ a: 1, savedAt: 0 }, null, { id: 5 }, { id: 'nosrc', updatedAt: 1 }] as any[];
  assert.deepEqual(mergeFavorites([], {}, junk, NOW).list, []); assert.deepEqual(mergeHistory([], {}, 0, junk, 0, NOW).entries, []);
  // clock skew: a device far in the future cannot win forever
  const m4 = mergeFavorites([fav('z', NOW + 10 * CLOCK_SKEW_MS)], {}, [], NOW); assert.equal(m4.list[0].savedAt, NOW + CLOCK_SKEW_MS);

  // ── History is separate: with history sync OFF nothing history-related moves
  const c2 = new FakeCloud();
  let H1 = await syncOnce(c2, dev({ history: [he('a')], syncHistory: false }), NOW); assert.equal(c2.hist.size, 0, 'history sync off → nothing uploaded');
  H1 = await syncOnce(c2, { ...H1, syncHistory: true }, NOW); assert.equal(c2.hist.size, 1);
  // most recently updated resume position wins; plays take the max
  let H2 = await syncOnce(c2, dev({ syncHistory: true }), NOW + 1);
  assert.equal(H2.history[0].id, 'a');
  H1 = await syncOnce(c2, { ...H1, history: [he('a', { progressSeconds: 100, updatedAt: NOW + 100, playedAt: NOW + 100, plays: 2 })] }, NOW + 200);
  H2 = await syncOnce(c2, { ...H2, history: [he('a', { progressSeconds: 40, updatedAt: NOW + 50, plays: 3 })] }, NOW + 300);
  assert.equal(H2.history[0].progressSeconds, 100, 'newer resume position (100s) beats older (40s)');
  assert.equal(H2.history[0].plays, 3, 'plays = max across devices');
  // audio vs classic versions are separate history rows
  H1 = await syncOnce(c2, { ...H1, history: [he('audio-ep1'), he('classic-ep1'), ...H1.history] }, NOW + 400);
  H2 = await syncOnce(c2, H2, NOW + 500); assert.deepEqual(H2.history.map((e) => e.id).sort(), ['a', 'audio-ep1', 'classic-ep1']);

  // ── Clear history propagates and old entries do not reappear
  const clearAt = NOW + 1000;
  H1 = await syncOnce(c2, { ...H1, history: [], histTombs: {}, historyClearedAt: clearAt }, clearAt);
  assert.equal(c2.cleared, clearAt); assert.equal(c2.hist.size, 0, 'cloud history physically removed');
  H2 = await syncOnce(c2, H2, clearAt + 10);
  assert.deepEqual(H2.history, [], 'other device drops its old entries on next sync');
  assert.equal(H2.historyClearedAt, clearAt);
  // a stale device that never saw the clear cannot resurrect old entries
  const stale = await syncOnce(c2, dev({ syncHistory: true, history: [he('old', { updatedAt: NOW - 5000, playedAt: NOW - 5000 })] }), clearAt + 20);
  assert.deepEqual(stale.history, [], 'stale offline device is cleared too'); assert.equal(c2.hist.size, 0);
  // but something watched AFTER the clear survives everywhere
  H1 = await syncOnce(c2, { ...H1, history: [he('new', { playedAt: clearAt + 500, updatedAt: clearAt + 500 })] }, clearAt + 600);
  H2 = await syncOnce(c2, H2, clearAt + 700); assert.deepEqual(H2.history.map((e) => e.id), ['new']);
  // single-entry removal syncs
  H1 = await syncOnce(c2, { ...H1, history: [], histTombs: { new: clearAt + 800 } }, clearAt + 800);
  H2 = await syncOnce(c2, H2, clearAt + 900); assert.deepEqual(H2.history, [], 'single removal propagated');

  // ── pure bits
  assert.deepEqual(mergeHistory([], {}, 0, [], 0, NOW).push, []);
  assert.deepEqual(parseLocalState('garbage'), parseLocalState(null));
  assert.deepEqual(parseLocalState(JSON.stringify({ version: 1, favTombs: { a: 1, b: 'x' }, historyClearedAt: 5 })).favTombs, { a: 1 });
  assert.equal(Object.keys(capTombs(Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i])))).length, 500);
  assert.equal(loadSyncSettings({ getItem: () => null }).historySync, false, 'History sync defaults OFF');
  assert.equal(loadSyncSettings({ getItem: () => '{"historySync":true}' }).historySync, true);
  console.log('cloud sync merge/engine: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
