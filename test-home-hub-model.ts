import assert from 'node:assert/strict';
import { DISCOVER_LIMIT, DISCOVER_PER_CATEGORY, DISMISSED_MAX, addDismissed, cardsForDay, clearDismissed, dayOf, jumpIndex, nextSeed, pickDiscover, readDismissed, readRowOpen, sessionSeed, writeRowOpen, type DiscoverItem, type KV } from './src/home/hubModel';

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
const broken: KV = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// rows: remembered, default when unset, survives blocked storage
const s = mem();
assert.equal(readRowOpen(s, 'classic48', false), false); writeRowOpen(s, 'classic48', true); assert.equal(readRowOpen(s, 'classic48', false), true);
assert.equal(readRowOpen(broken, 'discover', true), true); writeRowOpen(broken, 'discover', false); assert.equal(readRowOpen(null, 'discover', true), true);

// seed: stable within a session, new one on Shuffle, tolerant of blocked storage
assert.equal(sessionSeed(s, 111), '111'); assert.equal(sessionSeed(s, 999), '111', 'second visit keeps the seed');
const n1 = nextSeed(s, '111'); assert.notEqual(n1, '111'); assert.equal(sessionSeed(s, 5), n1); assert.notEqual(nextSeed(s, n1), n1);
assert.equal(sessionSeed(broken, 42), '42');

// dismissed: capped, deduped, cleared
for (let i = 0; i < DISMISSED_MAX + 20; i++) addDismissed(s, `k${i}`);
assert.equal(readDismissed(s).length, DISMISSED_MAX); assert.ok(!readDismissed(s).includes('k0')); assert.ok(readDismissed(s).includes(`k${DISMISSED_MAX + 19}`));
addDismissed(s, 'dup'); addDismissed(s, 'dup'); assert.equal(readDismissed(s).filter((k) => k === 'dup').length, 1);
clearDismissed(s); assert.deepEqual(readDismissed(s), []); assert.deepEqual(readDismissed(broken), []);

// discover: diversity, determinism, dismissal, no repeats
const cats = ['docs', 'otr', 'cinema', 'cartoons', 'books', 'news'];
const pool: DiscoverItem[] = [];
for (const c of cats) for (let i = 0; i < 15; i++) pool.push({ key: `${c}-${i}`, categoryId: c, categoryLabel: c, title: `${c} ${i}`, subtitle: '', mediaType: 'video', path: `/download/${c}${i}/x.mp4`, channelId: c, guideId: 'library', programId: `${c}-${i}` });
pool.push({ ...pool[0] }); // exact duplicate key
const a = pickDiscover(pool, 'seed-A', []);
assert.equal(a.length, DISCOVER_LIMIT); assert.equal(new Set(a.map((i) => i.key)).size, a.length, 'no repeats');
for (const c of cats) assert.ok(a.filter((i) => i.categoryId === c).length <= DISCOVER_PER_CATEGORY, `cap per category ${c}`);
assert.ok(new Set(a.map((i) => i.categoryId)).size >= 5, 'diverse');
assert.deepEqual(pickDiscover(pool, 'seed-A', []).map((i) => i.key), a.map((i) => i.key), 'same seed, same picks (Back navigation)');
assert.notDeepEqual(pickDiscover(pool, 'seed-B', []).map((i) => i.key), a.map((i) => i.key), 'Shuffle changes picks');
const dis = pickDiscover(pool, 'seed-A', [a[0].key, a[1].key]); assert.ok(!dis.some((i) => i.key === a[0].key || i.key === a[1].key));
assert.deepEqual(pickDiscover([], 'x', []), []);
assert.equal(pickDiscover([pool[0], pool[15], pool[30]], 'x', []).length, 3, 'small pool gives what it has');
assert.equal(pickDiscover(pool.slice(0, 3), 'x', []).length, DISCOVER_PER_CATEGORY, 'one category is still capped');

// classic row: day split, ended programs dropped, chronological, jump
const NOW = new Date(2026, 9, 14, 12, 30).getTime(); const H = 3600_000;
const prog = (id: string, start: number, end: number) => ({ programId: id, title: id, startMs: start, endMs: end, path: `/p/${id}`, mediaType: 'video' as const });
const chans = [
  { id: 'c1', name: 'Beta', programs: [prog('ended', NOW - 3 * H, NOW - H), prog('airing', NOW - H, NOW + H), prog('eve', new Date(2026, 9, 14, 19).getTime(), new Date(2026, 9, 14, 20).getTime()), prog('tom9', new Date(2026, 9, 15, 9).getTime(), new Date(2026, 9, 15, 10).getTime())] },
  { id: 'c2', name: 'Alpha', programs: [prog('late', new Date(2026, 9, 14, 23, 30).getTime(), new Date(2026, 9, 15, 0, 30).getTime()), prog('tom1', new Date(2026, 9, 15, 13).getTime(), new Date(2026, 9, 15, 14).getTime()), prog('dayafter', new Date(2026, 9, 16, 9).getTime(), new Date(2026, 9, 16, 10).getTime())] },
];
const today = cardsForDay(chans, 'today', NOW); assert.deepEqual(today.map((c) => c.programId), ['airing', 'eve', 'late']);
const tom = cardsForDay(chans, 'tomorrow', NOW); assert.deepEqual(tom.map((c) => c.programId), ['tom9', 'tom1']);
assert.equal(dayOf(new Date(2026, 9, 16, 9).getTime(), NOW), 'later');
assert.equal(jumpIndex(today, null), 0); assert.equal(today[jumpIndex(today, 19)].programId, 'eve'); assert.equal(today[jumpIndex(today, 23)].programId, 'late'); assert.equal(jumpIndex(tom, 12), 1);
assert.equal(jumpIndex([], 8), 0);
console.log('PASS home-hub-model');
