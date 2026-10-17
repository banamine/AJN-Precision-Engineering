/* RT Documentaries channel + fallback info card.
 * Hermetic: no network. Run: npx tsx test-rt-documentary.ts */
import assert from 'node:assert/strict';
import {
  buildRtPool, layoutRtDay, dayStartIndex, rtProgramFor, getRtDocumentaryChannel, resetRtStateForTests,
  fetchFreshItems, probeRtItem, RT_CHANNEL_ID, type RtIndexFile, type RtIndexRow, type RtItem,
} from './server/rtDocumentary';
import { buildFallbackShowInfo } from './src/showinfo/fallback';

/* ---- a synthetic index: uneven month sizes, a few bad rows ---- */
function makeIndex(): RtIndexFile {
  const rows: RtIndexRow[] = [];
  const sizes: Record<string, number> = { '2013-10': 3, '2013-11': 40, '2018-05': 120, '2022-03': 400, '2022-04': 9, '2025-12': 60 };
  for (const [ym, n] of Object.entries(sizes)) {
    const [y, m] = ym.split('-');
    for (let i = 0; i < n; i++) {
      const day = String(1 + (i % 27)).padStart(2, '0');
      const hh = String((i * 7) % 24).padStart(2, '0');
      rows.push([`${y}${m}${day}_${hh}${String((i * 13) % 60).padStart(2, '0')}00`, 1800 + (i % 5) * 20, 'eng']);
    }
  }
  rows.push(['20240101_000000', null, 'eng']);       // no runtime
  rows.push(['20240102_000000', 1800, 'rus']);       // not English
  rows.push(['20240103_000000', 30, 'eng']);         // absurd runtime
  rows.push(['garbage', 1800, 'eng']);               // bad stamp
  return { schema: 'ajn.rtDocumentaryIndex.v1', generatedAt: '2026-10-07T00:00:00Z', count: rows.length, items: rows };
}

const pool = buildRtPool(makeIndex());
assert.equal(pool.items.length, 3 + 40 + 120 + 400 + 9 + 60, 'only valid rows enter the pool');
assert.deepEqual(pool.excluded, { noRuntime: 1, badRuntime: 1, notEnglish: 1, badStamp: 1 });
assert.equal(pool.bucketKeys.length, 6);

/* ---- determinism: same inputs, same day, 20 runs, fresh pools ---- */
const day = new Date('2026-10-07T15:20:00Z');
const sig = (p = pool) => layoutRtDay(p, [], day).map((s) => `${s.item.id}@${s.startMs}-${s.endMs}`).join('|');
const first = sig();
for (let i = 0; i < 20; i++) assert.equal(sig(buildRtPool(makeIndex())), first, 'identical schedule on every build');
assert.equal(layoutRtDay(pool, [], new Date('2026-10-07T00:00:00Z')).map((s) => s.item.id).join(), layoutRtDay(pool, [], new Date('2026-10-07T23:59:59Z')).map((s) => s.item.id).join(), 'time of day does not change the day');

/* ---- real layout: covers the UTC day, no gaps, no overlaps, real runtimes ---- */
const slots = layoutRtDay(pool, [], day);
const dayStart = Date.UTC(2026, 9, 7);
assert.equal(slots[0].startMs, dayStart);
assert.equal(slots[slots.length - 1].endMs, dayStart + 86_400_000);
for (let i = 1; i < slots.length; i++) assert.equal(slots[i].startMs, slots[i - 1].endMs);
for (const s of slots.slice(0, -1)) assert.equal(s.endMs - s.startMs, s.item.runtime * 1000, 'full runtime except the slot cut at midnight');

/* ---- fairness over 90 days: every bucket airs; small buckets are not starved ---- */
const counts = new Map<string, number>();
const lastSeen = new Map<string, number>();
let maxGap = 0;
for (let d = 0; d < 90; d++) {
  const when = new Date(Date.UTC(2026, 9, 1 + d, 12));
  for (const s of layoutRtDay(pool, [], when)) {
    counts.set(s.item.bucket, (counts.get(s.item.bucket) ?? 0) + 1);
    const prev = lastSeen.get(s.item.bucket);
    if (prev !== undefined) maxGap = Math.max(maxGap, s.startMs - prev);
    lastSeen.set(s.item.bucket, s.startMs);
  }
}
assert.equal(counts.size, 6, 'every bucket aired in 90 days');
const vals = [...counts.values()];
assert.ok(Math.max(...vals) / Math.min(...vals) < 1.2, `buckets share airtime evenly (counts ${JSON.stringify([...counts])})`);
assert.ok(maxGap <= 2 * 86_400_000, `no bucket waits more than 2 days (gap ${(maxGap / 3_600_000).toFixed(1)}h)`);
// inside the big bucket every item eventually plays (permutation cycles)
const seen2022 = new Set<string>();
for (let d = 0; d < 400 && seen2022.size < 400; d++) for (const s of layoutRtDay(pool, [], new Date(Date.UTC(2026, 0, 1 + d, 1)))) if (s.item.bucket === '2022-03') seen2022.add(s.item.id);
assert.equal(seen2022.size, 400, 'all 400 items of the largest bucket air within 400 days');

/* ---- fresh lane: new items get every 6th slot, rest of the day keeps its order ---- */
const freshItems: RtItem[] = [0, 1, 2].map((i) => ({ id: `RT_2026100${i + 1}_120000_Documentary`, airedMs: Date.UTC(2026, 9, i + 1, 12), runtime: 1860, bucket: '2026-10' }));
const withFresh = layoutRtDay(pool, freshItems, day);
const freshSlots = withFresh.filter((s) => s.fresh);
assert.ok(freshSlots.length >= 6, 'fresh slots appear');
for (const s of withFresh) assert.equal(s.fresh, s.sequence % 6 === 5, 'fresh only on every 6th sequence position');
assert.ok(freshItems.every((f) => freshSlots.some((s) => s.item.id === f.id)), 'every fresh item airs today');
assert.deepEqual(withFresh.filter((s) => !s.fresh).slice(0, 5).map((s) => s.item.id), slots.filter((s) => s.sequence % 6 !== 5).slice(0, 5).map((s) => s.item.id), 'non-fresh order unchanged');

/* ---- skip set: unplayable items are skipped, never substituted by another source ---- */
const victim = slots[2].item.id;
const skipped = layoutRtDay(pool, [], day, new Set([victim]));
assert.ok(!skipped.some((s) => s.item.id === victim));
assert.equal(skipped[skipped.length - 1].endMs, dayStart + 86_400_000);

/* ---- Program shape: real clip windows via the proxy, honest metadata ---- */
const p = rtProgramFor(slots[0], dayStart, 0, 'cable-tv');
assert.equal(p.channelId, RT_CHANNEL_ID);
assert.equal(p.mediaType, 'video');
const segs = p.metadata!.segments as Array<{ start: number; end: number; archivePath: string; mediaUrl: string }>;
assert.equal(segs[0].start, 0);
assert.equal(segs[segs.length - 1].end, slots[0].item.runtime);
for (const sg of segs) {
  assert.match(sg.archivePath, new RegExp(`^/download/${slots[0].item.id}/${slots[0].item.id}\\.mp4\\?exact=1&start=${sg.start}&end=${sg.end}$`));
  assert.ok(sg.end - sg.start <= 282);
  assert.ok(sg.mediaUrl.startsWith('/api/archive/proxy?path='));
}
assert.equal(p.mediaUrl, segs[0].mediaUrl);
assert.match(p.title, /^[A-Z][a-z]{2} \d{1,2}, \d{4} · RT Documentary$/);
assert.ok(!/Math\.random/.test(String(p.description)));

/* ---- channel: first in group, error states are explicit ---- */
resetRtStateForTests();
const okFetch = (async (url: any) => {
  const u = String(url);
  assert.ok(u.includes('advancedsearch'), 'only the search endpoint is called');
  assert.ok(decodeURIComponent(u).includes('collection:tvnews AND identifier:RT_*_Documentary AND date:['));
  return new Response(JSON.stringify({ response: { docs: [
    { identifier: 'RT_20261006_120000_Documentary', runtime: '00:30:59', language: 'eng' },
    { identifier: 'RT_20261007_150000_Documentary', runtime: '00:31:00', language: 'eng' },   // too new: still processing
    { identifier: 'RT_20261005_120000_Documentary', runtime: '00:30:30', language: 'rus' },   // not English
    { identifier: 'something-else', runtime: '00:30:00', language: 'eng' },                   // not an RT item
  ] } }), { status: 200 });
}) as typeof fetch;
const channel = await getRtDocumentaryChannel('cable-tv', { loadIndex: async () => makeIndex(), fetchImpl: okFetch, now: () => day, probe: async () => 'ok' });
assert.equal(channel.id, RT_CHANNEL_ID);
assert.equal(channel.sourceStatus, 'ok');
assert.ok(channel.programs.length > 30);
assert.ok(channel.programs.some((x) => x.metadata?.freshSlot && x.metadata?.externalId === 'RT_20261006_120000_Documentary'), 'fresh broadcast is on air today');
assert.ok(!channel.programs.some((x) => x.metadata?.externalId === 'RT_20261007_150000_Documentary'), 'unprocessed broadcast is not scheduled');
assert.ok(new Set(channel.programs.map((x) => x.id)).size === channel.programs.length, 'program ids unique');

resetRtStateForTests();
const failFetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
const partial = await getRtDocumentaryChannel('cable-tv', { loadIndex: async () => makeIndex(), fetchImpl: failFetch, now: () => day, probe: async () => 'ok' });
assert.equal(partial.sourceStatus, 'partial');
assert.match(String(partial.sourceError), /503/);
assert.ok(partial.programs.length > 30, 'the base rotation still plays when the fresh search fails');

resetRtStateForTests();
const broken = await getRtDocumentaryChannel('cable-tv', { loadIndex: async () => { throw new Error('boom'); }, now: () => day });
assert.equal(broken.sourceStatus, 'upstream_error');
assert.equal(broken.programs.length, 0, 'no stand-in programs');
assert.match(String(broken.sourceError), /boom/);

/* ---- admission: unplayable are reported and skipped on the next build ---- */
resetRtStateForTests();
const target = layoutRtDay(pool, [], day).find((s) => s.endMs > day.getTime())!.item.id;
const bad = await getRtDocumentaryChannel('cable-tv', { loadIndex: async () => makeIndex(), fetchImpl: okFetch, now: () => day, probe: async (id) => (id === target ? 'unplayable' : 'ok') });
await new Promise((r) => setTimeout(r, 20));
const after = await getRtDocumentaryChannel('cable-tv', { loadIndex: async () => makeIndex(), fetchImpl: okFetch, now: () => day, probe: async () => 'ok' });
assert.ok(!after.programs.some((x) => x.metadata?.externalId === target), 'unplayable item skipped');
assert.ok(after.rejected?.some((r) => r.id === target && /unplayable/.test(r.reason)), 'and reported');
assert.ok(bad.programs.length > 0);

/* ---- probe classification ---- */
const mk = (status: number, type: string) => (async () => new Response('x', { status, headers: { 'content-type': type } })) as typeof fetch;
assert.equal(await probeRtItem('RT_20261006_120000_Documentary', mk(206, 'video/mp4')), 'ok');
assert.equal(await probeRtItem('RT_20261006_120000_Documentary', mk(200, 'text/html; charset=UTF-8')), 'unplayable');
assert.equal(await probeRtItem('RT_20261006_120000_Documentary', mk(403, 'text/html')), 'unplayable');
assert.equal(await probeRtItem('RT_20261006_120000_Documentary', mk(503, 'text/html')), 'unknown');
assert.equal(await probeRtItem('RT_20261006_120000_Documentary', mk(429, 'text/html')), 'unknown');
assert.equal(await probeRtItem('x', (async () => { throw new Error('net'); }) as typeof fetch), 'unknown');
assert.deepEqual(await fetchFreshItems(day, okFetch).then((r) => r.map((x) => x.id)), ['RT_20261006_120000_Documentary']);

/* ---- day boundary is stable across calls ---- */
assert.equal(dayStartIndex(pool, 5), dayStartIndex(pool, 5));
assert.ok(dayStartIndex(pool, 6) > dayStartIndex(pool, 5));

/* ---- fallback info card: truthful, covers every channel ---- */
const rtCard = buildFallbackShowInfo(channel);
assert.equal(rtCard.title, 'RT Documentaries');
assert.match(rtCard.overview, /video channel in the “Documentary” group/);
assert.ok(rtCard.facts.some((f) => /Originally aired \d{4}-\d{2}-\d{2}/.test(f)));
assert.ok(rtCard.facts.includes('Source: Internet Archive'));
assert.match(rtCard.link!.href, /^https:\/\/archive\.org\/details\/RT_\d{8}_\d{6}_Documentary$/);
assert.equal(buildFallbackShowInfo(channel), rtCard, 'memoised');
const empty = buildFallbackShowInfo({ id: 'x', name: 'Empty', group: 'News', mediaType: 'video', programs: [], sourceError: 'upstream down' });
assert.match(empty.overview, /Nothing is scheduled.*upstream down/);
assert.equal(empty.link, null);
const audio = buildFallbackShowInfo({ id: 'a', name: 'Radio', mediaType: 'audio', programs: [{ title: 'Song 00:00', startTimeUtc: undefined, archivePath: undefined, metadata: {} }] });
assert.match(audio.overview, /audio channel/);
assert.equal(audio.facts.includes('Source: Internet Archive'), false, 'no source claim without archive paths');

console.log('test-rt-documentary: ALL PASS');
