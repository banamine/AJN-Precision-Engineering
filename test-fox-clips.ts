// "Police Chase" (group FOX Clips) on Cable TV: channel shape, 24-hour upkeep, discovery. No network: fetch is mocked.
import assert from 'node:assert/strict';
import { getScheduleForGuide, setCableNewsFetchForTests } from './guideRegistry.ts';
import { validateFoxClips, getFoxClipsChannels, foxClipSeed, FOX_CLIPS_GROUP, FOX_CLIPS_CHANNEL_ID } from './server/foxClips.ts';
import { checkFoxClips, discoverFoxClips, currentFoxClips, foxClipsSummary, setFoxClipsFetchForTests, probeMp4, runFoxClipsCycle } from './server/foxClipsRefresh.ts';
import { libraryFromChannels, LIBRARY_SOURCES } from './server/library.ts';
import { LIVE_NEWS_GROUP } from './server/liveNewsChannels.ts';

setCableNewsFetchForTests((async (input: any) => {
  const url = decodeURIComponent(String(input));
  return url.includes('advancedsearch') ? new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 }) : new Response('', { status: 404 });
}) as typeof fetch);

const seed = foxClipSeed() as Array<{ id: string; title: string; seconds: number; mp4: string; etag: string; size: number; lastModified: string }>;

// 1. Data + channel shape.
const { valid, rejected } = validateFoxClips(seed);
assert.deepEqual(rejected, []); assert.equal(valid.length, seed.length); assert.ok(valid.length >= 16);
assert.ok(valid.every((c) => c.thumb?.startsWith('https://images.foxtv.com/')), 'every clip has a thumbnail');
assert.equal(validateFoxClips([{ ...seed[0], thumb: 'http://images.foxtv.com/a.jpg' }]).valid[0].thumb, undefined, 'non-https thumb dropped');
assert.equal(validateFoxClips([{ ...seed[0], thumb: 'https://evil.example/a.jpg' }]).valid[0].thumb, undefined, 'other-host thumb dropped');
const day = new Date('2026-10-14T12:00:00Z');
const [ch] = getFoxClipsChannels('cable-tv', day);
assert.equal(ch.id, FOX_CLIPS_CHANNEL_ID); assert.equal(ch.name, 'Police Chase'); assert.equal(ch.group, FOX_CLIPS_GROUP);
const ps = ch.programs;
assert.equal(new Date(ps[0].startTimeUtc).toISOString(), '2026-10-14T00:00:00.000Z');
assert.equal(new Date(ps[ps.length - 1].endTimeUtc).toISOString(), '2026-10-15T00:00:00.000Z', 'fills exactly one UTC day');
for (let i = 1; i < ps.length; i++) assert.equal(ps[i].startTimeUtc, ps[i - 1].endTimeUtc, 'contiguous');
assert.equal(new Set(ps.map((p) => p.id)).size, ps.length, 'program ids unique');
for (const p of ps) { assert.ok((p.metadata as any).thumb, 'program carries its thumbnail'); assert.match(p.mediaUrl!, /^https:\/\/static-clips\.fox\.com\/.+\.mp4$/); assert.equal((p.metadata as any).externalClip, true); assert.equal(p.isArchivedSource, false); assert.equal(p.sourceClass, undefined); }
const p0 = ps[0], len0 = (Date.parse(p0.endTimeUtc) - Date.parse(p0.startTimeUtc)) / 1000;
assert.ok(Math.abs(len0 - (p0.metadata as any).durationSeconds) < 1, 'program length = clip length');
const tomorrow = getFoxClipsChannels('cable-tv', new Date('2026-10-15T12:00:00Z'))[0].programs;
assert.notEqual(tomorrow[0].id.split(':')[0], ps[0].id.split(':')[0], 'rotation moves on the next day');
assert.deepEqual(getFoxClipsChannels('cable-tv', day, []), [], 'no clips -> no channel');

// 2. Validator rejects what it must.
const ok = { ...seed[0] , verifiedAt: '2026-10-14' };
const bad = validateFoxClips([ok, { ...ok, id: 'abc' }, { ...ok, id: '999991', mp4: 'http://static-clips.fox.com/a.mp4' }, { ...ok, id: '999992', mp4: 'https://evil.example/a.mp4' },
  { ...ok, id: '999993', mp4: 'https://static-clips.fox.com/a.m3u8' }, { ...ok, id: '999994', mp4: 'https://static-clips.fox.com/b.mp4', seconds: 5 }, { ...ok, id: '999995', mp4: 'https://static-clips.fox.com/c.mp4', verifiedAt: '' }, { ...ok, id: seed[0].id }]);
assert.equal(bad.valid.length, 1); assert.equal(bad.rejected.length, 7);

// 3. Cable TV: Archive rows first, then Live News, then FOX Clips; Library never lists the clips.
const cable = await getScheduleForGuide('cable-tv');
const gi = (g: string) => cable.findIndex((c) => c.group === g);
assert.ok(gi(FOX_CLIPS_GROUP) > -1 && gi(LIVE_NEWS_GROUP) > -1 && gi(FOX_CLIPS_GROUP) > cable.map((c) => c.group).lastIndexOf(LIVE_NEWS_GROUP), 'FOX Clips after Live News');
assert.equal(cable.filter((c) => c.group === FOX_CLIPS_GROUP).length, 1);
assert.equal(new Set(cable.map((c) => c.id)).size, cable.length, 'channel ids unique'); assert.equal(new Set(cable.map((c) => c.name.toLowerCase())).size, cable.length, 'channel names unique');
const src = LIBRARY_SOURCES.filter((s) => s.guideId === 'cable-tv');
const forced = src.map((s) => { const cat = cable.map((c) => s.category(c)).find(Boolean) ?? 'news'; return { ...s, channels: cable, category: () => cat as any }; });
const libAll = libraryFromChannels(forced as any); // every cable channel forced into one category: only the externalClip rule can keep FOX clips out
assert.ok(libAll.length > 0 || cable.every((c) => c.group === FOX_CLIPS_GROUP || c.group === LIVE_NEWS_GROUP), 'library is not vacuously empty');
const lib = JSON.stringify(libAll);
assert.ok(!lib.includes('fox-clip-') && !lib.includes('static-clips.fox.com'), 'Library skips FOX clips');

// ---- mock FOX ----
const be32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const str = (s: string) => new TextEncoder().encode(s);
function mp4(seconds: number, codecs = true): Uint8Array {
  const mvhd = cat(str('mvhd'), new Uint8Array([0, 0, 0, 0]), be32(0), be32(0), be32(1000), be32(Math.round(seconds * 1000)), new Uint8Array(80));
  const body = cat(mvhd, str(codecs ? 'avc1mp4a' : 'xxxxxxxx'));
  const moov = cat(be32(body.length + 8), str('moov'), body);
  return cat(be32(16), str('ftyp'), str('isom'), be32(0), moov, new Uint8Array(500));
}
type Fake = { status?: number; seconds: number; codecs?: boolean; etag?: string; type?: string; lm?: string };
const files = new Map<string, Fake>();
const pages = new Map<string, { title: string; links: string[] }>();
const urlOf = (id: string) => `https://static-clips.fox.com/proxy/fts_clip/digital/fts/lnfx/${id}/${id}__x_lowres.mp4`;
const idOf = (u: URL) => u.pathname.match(/lnfx\/(\d+)\//)![1];
for (const c of seed) { files.set(c.id, { seconds: c.seconds, etag: c.etag, lm: c.lastModified }); }
const mock = (async (input: any, init: any) => {
  const u = new URL(String(input));
  if (u.hostname === 'www.livenowfox.com') {
    const id = u.pathname.split('/').pop()!;
    const pg = pages.get(id) ?? (files.has(id) ? { title: seed.find((s) => s.id === id)?.title ?? 'x', links: [...pages.keys()] } : null);
    if (!pg) return new Response('', { status: 404 });
    return new Response(`<meta property="og:title" content="${pg.title}"><script>{"uploadDate":"2026-10-01T10:00:00-04:00","contentUrl":"${urlOf(id)}"}</script>` + pg.links.map((l) => `<a href="/video/${l}">x</a>`).join(''), { status: 200 });
  }
  if (u.hostname !== 'static-clips.fox.com') return new Response('', { status: 404 });
  const f = files.get(idOf(u)); if (!f) return new Response('', { status: 404 });
  if (f.status && f.status !== 200) return new Response('', { status: f.status });
  const data = mp4(f.seconds, f.codecs !== false); const h: Record<string, string> = { 'content-type': f.type ?? 'video/mp4', 'content-length': String(data.length), etag: f.etag ?? '"e"', 'last-modified': f.lm ?? 'x' };
  if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  const m = String(init?.headers?.Range ?? '').match(/bytes=(\d+)-(\d+)/);
  const responseData = m ? data.slice(+m[1], +m[2] + 1) : data;
  return new Response(new Uint8Array(responseData), { status: m ? 206 : 200, headers: h });
}) as typeof fetch;
setFoxClipsFetchForTests(mock);
// Sizes in the mock are the mock's own: sync the seed records once so "unchanged" is truly unchanged.
for (const c of seed) { const d = mp4(c.seconds); (c as any).size = d.length; }
// (re-seed records with the mock sizes through a first run, then treat that state as the baseline)
await checkFoxClips();
const baselineChanged = foxClipsSummary().changed.length; assert.equal(baselineChanged, seed.length, 'first run sees the mock size differ from the real file and refreshes every record');
await checkFoxClips();
assert.equal(foxClipsSummary().changed.length, 0, 'second run: nothing changed'); assert.equal(currentFoxClips().length, seed.length);

// 4. probe.
const pr = await probeMp4(urlOf(seed[0].id), mp4(seed[0].seconds).length); assert.ok(Math.abs(pr.seconds - seed[0].seconds) < 0.01); assert.ok(pr.avc1 && pr.aac);

// 5. One failed check keeps the clip; the second in a row hides it; a success brings it back.
const victim = seed[3].id; files.get(victim)!.status = 404;
await checkFoxClips(); assert.ok(currentFoxClips().some((c) => c.id === victim), 'first miss keeps it'); assert.deepEqual(foxClipsSummary().pendingRecheck, [victim]);
await checkFoxClips(); assert.ok(!currentFoxClips().some((c) => c.id === victim), 'second miss in a row hides it'); assert.equal(foxClipsSummary().hidden, 1);
assert.ok(!JSON.stringify(getFoxClipsChannels('cable-tv', day, currentFoxClips())).includes(`fox-clip-${victim}"`), 'hidden clip leaves the channel');
files.get(victim)!.status = 200; await checkFoxClips(); assert.ok(currentFoxClips().some((c) => c.id === victim), 'success brings it back');

// 6. A replaced file (new ETag + length) is re-read and the record updated; a replacement that is not H.264/AAC is held back.
const rep = seed[5].id; files.set(rep, { seconds: 400, etag: '"new"', lm: 'y' });
await checkFoxClips(); assert.deepEqual(foxClipsSummary().changed, [seed[5].title]);
assert.equal(currentFoxClips().find((c) => c.id === rep)!.seconds, 400);
files.set(rep, { seconds: 400, etag: '"newer"', lm: 'z', codecs: false });
await checkFoxClips(); assert.equal(currentFoxClips().find((c) => c.id === rep)!.seconds, 400, 'record kept as is'); assert.equal((foxClipsSummary().pendingRecheck as string[]).includes(rep), true);
files.set(rep, { seconds: 400, etag: '"newer"', lm: 'z' }); await checkFoxClips();

// 7. Most clips failing at once = our network: nothing is hidden.
for (const f of files.values()) f.status = 500;
const net = await checkFoxClips(); assert.equal(net.applied, false); await checkFoxClips();
assert.equal(foxClipsSummary().hidden, 0, 'nothing hidden'); assert.equal(foxClipsSummary().skippedRun, true);
for (const f of files.values()) f.status = 200; await checkFoxClips();

// 8. Discovery: new chase clip is added only if it passes the tests.
pages.set('900001', { title: 'Suspect leads police on pursuit', links: [] }); files.set('900001', { seconds: 600 });
pages.set('900002', { title: 'Cooking with the stars', links: [] }); files.set('900002', { seconds: 300 });
pages.set('900003', { title: 'Police chase ends in crash', links: [] }); files.set('900003', { seconds: 300, status: 404 });
pages.set('900004', { title: 'Pursuit on the freeway', links: [] }); files.set('900004', { seconds: 300, codecs: false });
pages.set('900005', { title: 'Short police chase', links: [] }); files.set('900005', { seconds: 3 });
const before = currentFoxClips().length;
await discoverFoxClips();
const s = foxClipsSummary();
assert.deepEqual(s.added, ['Suspect leads police on pursuit']); assert.equal(currentFoxClips().length, before + 1);
const why = Object.fromEntries(s.notAdded.map((n) => [n.id, n.reason]));
assert.match(why['900002'], /not a chase/); assert.match(why['900003'], /404/); assert.match(why['900004'], /H\.264/); assert.match(why['900005'], /length/);
await discoverFoxClips(); assert.deepEqual(foxClipsSummary().added, [], 'already-known clip is not added twice');

// 9. Full cycle runs end to end.
await runFoxClipsCycle(); assert.ok(foxClipsSummary().lastRun);
console.log(`test-fox-clips: ok (${valid.length} seed clips, ${ps.length} programs in one day)`);
