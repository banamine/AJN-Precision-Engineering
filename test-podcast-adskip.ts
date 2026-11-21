import assert from 'node:assert/strict';
const A = await import('./src/utils/podcastAdSkip.ts');
const { parseAdMap, adMapFor, fetchAdMap } = await import('./server/podcastAdMap.ts');

/* ---- budget ---- */
assert.deepEqual(A.adBudget(3028.6, 2384).state, 'ads');
assert.equal((A.adBudget(3028.6, 2384) as any).seconds.toFixed(1), '644.6');
assert.equal(A.adBudget(2384.2, 2384).state, 'none', 'within tolerance');
assert.equal(A.adBudget(2300, 2384).state, 'none', 'file shorter than feed');
assert.deepEqual(A.adBudget(3000, undefined), { state: 'unknown', why: 'feed-length-missing' });
assert.deepEqual(A.adBudget(3000, 30), { state: 'unknown', why: 'feed-length-missing' }, 'rounded/garbage feed length is not trusted');
assert.deepEqual(A.adBudget(NaN, 2000), { state: 'unknown', why: 'not-loaded' });
assert.deepEqual(A.adBudget(3000, 600), { state: 'unknown', why: 'feed-length-mismatch' });
assert.match(A.budgetLine(A.adBudget(3028.6, 2384))!, /about 10:45/);
assert.equal(A.budgetLine({ state: 'unknown', why: 'not-loaded' }), null);
assert.equal(A.fmtMS(3725), '1:02:05'); assert.equal(A.fmtMS(155.4), '2:35');

/* ---- map parsing: the REAL hop address of "Stocking Up!" (query trimmed to the marker fields) ---- */
const hop = 'https://iheartmedia.pdn.tritondigital.com/v1/download/x/y/z/published-1.mp3?u=1&o=2303513&f=47782&pt=%7B%22n%22%3A5%7D&tt=%7B%22n%22%3A5%7D&mt=%5B%7B%22o%22%3A393842,%22n%22%3A5,%22t%22%3A%5B%22midroll_pos_1%22,%22midroll_pos_-2%22%5D%7D,%7B%22o%22%3A1045900,%22n%22%3A5,%22t%22%3A%5B%22midroll_pos_2%22,%22midroll_pos_-1%22%5D%7D%5D&i=abc';
const m = parseAdMap(hop)!;
assert.equal(m.cleanSeconds, 2303.513);
assert.deepEqual(m.pods.map((p) => [p.kind, p.cleanAt, p.ads]), [['pre', 0, 5], ['mid', 393.8, 5], ['mid', 1045.9, 5], ['post', 2303.513, 5]]);
assert.equal(parseAdMap('https://x.example/a.mp3?mt=dynamic&o=5'), null, 'mt=dynamic is not a layout');
assert.equal(parseAdMap('not a url'), null);
const three = parseAdMap('https://h/x?o=3088760&pt=%7B%22n%22%3A5%7D&tt=%7B%22n%22%3A5%7D&mt=%5B%7B%22o%22%3A1791300,%22n%22%3A5%7D,%7B%22o%22%3A684000,%22n%22%3A5%7D,%7B%22o%22%3A1085600,%22n%22%3A5%7D%5D')!;
assert.deepEqual(three.pods.filter((p) => p.kind === 'mid').map((p) => p.cleanAt), [684, 1085.6, 1791.3], 'sorted, 3 mid breaks (Dirty Bomb)');
const bad = parseAdMap('https://h/x?o=100&pt=%7B%22n%22%3A99%7D&mt=%5B%7B%22o%22%3A-5,%22n%22%3A5%7D,%7B%22o%22%3A%22x%22%7D%5D')!;
assert.equal(bad, null, 'absurd values are dropped, nothing invented');

/* ---- estimates vs the REAL served file of "Stocking Up!" (budget 583.8: breaks measured at 0-151.7, 545.6-700.9, 1352.9-1508.2, 2765.7-end) ---- */
const est = A.estimatePods(m.pods, 2887.3 - 2303.513, 2303.513);
assert.equal(est.length, 4);
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(1)} vs ${b} (±${tol})`);
near(est[0].startServed, 0, 0.01, 'pre start'); near(est[0].endServed, 151.7, 3, 'pre end');
near(est[1].startServed, 545.6, 3, 'mid1 start'); near(est[1].endServed, 700.9, 6, 'mid1 end');
near(est[2].startServed, 1352.9, 6, 'mid2 start'); near(est[2].endServed, 1508.2, 9, 'mid2 end');
near(est[3].startServed, 2765.7, 9, 'post start'); near(est[3].endServed, 2887.3, 0.1, 'post end = end of file');
assert.deepEqual(A.estimatePods(m.pods, 0, 2303), [], 'no ad seconds = no breaks');
assert.equal(A.estimatePods(m.pods, 12, 2303).length, 1, 'tiny budget: only what fits');

/* ---- prompt ---- */
const none = new Set<string>();
assert.equal(A.chipFromPods(est, 600, 2887, none)!.kind, 'mid', '600 s is inside the first mid break');
let c = A.chipFromPods(est, 3, 2887.3, none)!;
assert.equal(c.kind, 'pre'); assert.equal(c.inside, true); near(c.skipSeconds, 148.8, 4, 'skip from 0:03');
assert.equal(A.chipFromPods(est, 300, 2887.3, none), null, 'plain show: no prompt');
c = A.chipFromPods(est, 520, 2887.3, none)!; assert.equal(c.kind, 'mid'); assert.equal(c.inside, false); assert.ok(c.startsIn > 20 && c.startsIn < 30, 'prompt 45 s ahead');
assert.equal(A.chipFromPods(est, 520, 2887.3, new Set(['map:1'])), null, 'handled break stays quiet');
assert.equal(A.chipFromPods(est, 700, 2887.3, none), null, 'last 8 s of a break: not worth a prompt');

/* ---- bursts: impatience filter and net landing ---- */
let b = new A.BurstTracker();
b.seek(100, 130, 0); assert.deepEqual(b.take(20000), [], 'one +30 = a caller skip, not an ad break');
b = new A.BurstTracker();
b.seek(100, 130, 0); b.seek(100, 160, 1500); assert.deepEqual(b.take(20000), [{ at: 100, len: 60 }], '+30 +30 = 60 s');
b = new A.BurstTracker();
b.seek(500, 680, 0); b.seek(500, 665, 3000); assert.deepEqual(b.take(20000), [{ at: 500, len: 165 }], 'overshoot by 15 then back 15: lands on the exact 165 s boundary');
b = new A.BurstTracker();
b.seek(500, 560, 0); assert.deepEqual(b.take(5000), [], 'still inside the settle window'); assert.equal(b.open, true);
assert.deepEqual(b.take(9500), [{ at: 500, len: 60 }]);
b.seek(500, 560, 20000); b.seek(560, 590, 40000); // two separate bursts: 60 then a 30 (dropped)
assert.deepEqual(b.take(60000), [{ at: 500, len: 60 }]);
b = new A.BurstTracker(); b.seek(900, 800, 0); assert.deepEqual(b.take(0, true), [], 'rewinds never count');

b = new A.BurstTracker();
b.seek(0, 152, 0); b.seek(540, 698, 4000); // two different skips 4 s apart, far apart in the episode
assert.deepEqual(b.take(30000), [{ at: 0, len: 152 }, { at: 540, len: 158 }], 'a tap that does not continue from the last landing is a new skip');
b = new A.BurstTracker(); b.seek(100, 130, 0); b.seek(100, 160, 400); b.seek(160, 190, 2500); assert.deepEqual(b.take(30000), [{ at: 100, len: 90 }], 'stale-currentTime taps and continuing taps both merge');
assert.equal(A.canAccept({ inside: true, startsIn: -30 }), true); assert.equal(A.canAccept({ inside: false, startsIn: 14 }), true); assert.equal(A.canAccept({ inside: false, startsIn: 26 }), false, 'too early: would cut show');

/* ---- memory: persistence + bad data ---- */
const store = new Map<string, string>(); const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
let mem = A.loadMemory('pod-kuhner', st); assert.equal(mem.mode, 'ask'); assert.deepEqual(mem.events, []);
mem = A.addEvent(mem, { at: 0, len: 152, remaining: 2300, ep: 'e1', when: 1 }); A.saveMemory('pod-kuhner', mem, st);
assert.equal(A.loadMemory('pod-kuhner', st).events.length, 1);
store.set('ajn-adskip.v1:bad', '{"events":[{"at":"x"},{"at":1,"len":60,"remaining":9,"ep":"a","when":2}],"mode":"off","accepted":-4}');
const bm = A.loadMemory('bad', st); assert.equal(bm.events.length, 1); assert.equal(bm.mode, 'off'); assert.equal(bm.accepted, 0);
store.set('ajn-adskip.v1:junk', '{{{'); assert.deepEqual(A.loadMemory('junk', st), A.emptyMemory());
let many = A.emptyMemory(); for (let i = 0; i < 90; i++) many = A.addEvent(many, { at: i, len: 60, remaining: 500, ep: 'e' + i, when: i }); assert.equal(many.events.length, A.MAX_EVENTS);
for (let i = 0; i < 40; i++) many = A.markSeen(many, 's' + i); assert.equal(many.seen.length, A.MAX_SEEN);
assert.equal(A.markSeen(many, 's39'), many, 'already seen: same object');
assert.doesNotThrow(() => A.saveMemory('x', mem, { getItem: () => null, setItem: () => { throw new Error('quota'); } }));

/* ---- learned windows (show without a map): needs 2 different episodes ---- */
let lm = A.emptyMemory();
const ev = (at: number, len: number, remaining: number, ep: string) => ({ at, len, remaining, ep, when: 0 });
lm = A.addEvent(lm, ev(2, 150, 2800, 'e1')); lm = A.addEvent(lm, ev(0, 152, 3000, 'e2'));            // opening, 2 episodes
lm = A.addEvent(lm, ev(600, 120, 2200, 'e1')); lm = A.addEvent(lm, ev(660, 125, 2300, 'e2'));         // mid, 2 episodes within 90 s
lm = A.addEvent(lm, ev(1500, 120, 1300, 'e1'));                                                        // mid seen once: not a habit yet
lm = A.addEvent(lm, ev(2700, 100, 105, 'e1')); lm = A.addEvent(lm, ev(2900, 98, 100, 'e2'));         // ran to the end twice
const w = A.learnedWindows(lm);
assert.deepEqual(w.map((x) => x.kind).sort(), ['mid', 'post', 'pre']);
assert.equal(w.find((x) => x.kind === 'mid')!.episodes, 2); assert.equal(w.find((x) => x.kind === 'mid')!.anchor, 630);
assert.equal(A.learnedWindows(A.addEvent(A.emptyMemory(), ev(600, 120, 2200, 'e1'))).length, 0, 'one episode is not a pattern');
const sameEp = A.addEvent(A.addEvent(A.emptyMemory(), ev(600, 120, 2200, 'e1')), ev(640, 120, 2200, 'e1')); assert.equal(A.learnedWindows(sameEp).length, 0, 'the same episode twice is still one episode');
c = A.chipFromLearned(w, 590, 3000, none)!; assert.equal(c.kind, 'mid'); assert.equal(c.source, 'learned');
assert.equal(A.chipFromLearned(w, 300, 3000, none), null);
c = A.chipFromLearned(w, 1, 3000, none)!; assert.equal(c.kind, 'pre');
assert.equal(A.coveredKeys({ at: 590, len: 120 }, [], w, 3000).length, 1, 'a skip over the habit covers it');

/* ---- server: redirect walk stops at the marker hop and never fetches audio ---- */
const hops = ['https://podtrac.com/pts/redirect.mp3/x', 'https://traffic.omny.fm/d/x', hop, 'https://never.example/audio.mp3'];
const asked: string[] = [];
const fake = (async (u: any) => { const i = asked.length; asked.push(String(u)); return new Response(null, { status: 302, headers: { location: hops[i + 1] } }); }) as typeof fetch;
const got = await fetchAdMap(hops[0], fake);
assert.equal(got!.pods.length, 4); assert.equal(asked.length, 2, 'asked podtrac and omny only: the marker address is read from omny\'s reply and that hop itself is never requested');
assert.ok(!asked.some((x) => x.includes('never.example')));
const plain = (async () => new Response(null, { status: 206 })) as typeof fetch;
assert.equal(await fetchAdMap('https://cdn.example.com/a.mp3', plain), null, 'no markers = null, not an invented map');
await assert.rejects(() => fetchAdMap('http://insecure.example/a.mp3', plain), /not allowed/);
await assert.rejects(() => fetchAdMap('https://127.0.0.1/a.mp3', plain), /not allowed/);
const toPrivate = (async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } })) as typeof fetch;
await assert.rejects(() => fetchAdMap('https://cdn.example.com/a.mp3', toPrivate), /not allowed/, 'a redirect into a private address is refused');
(await import('./server/podcasts.ts')).setPodcastFetchForTests((async () => new Response('x', { status: 500 })) as typeof fetch); // no real feeds in a unit test
const unknown = await adMapFor('https://evil.example/a.mp3'); assert.equal(unknown.status, 404, 'only enclosures the app published');
console.log('podcast ad-skip: all tests passed');
