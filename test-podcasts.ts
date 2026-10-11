// Offline regression for server/podcasts.ts: streamed read, identity check, rejection reasons, last-good, direct (unproxied) URLs.
import assert from 'node:assert/strict';
const P = await import('./server/podcasts.ts');
const { layoutDailySchedule } = await import('./guideRegistry.ts');

const NOW = new Date('2026-10-10T12:00:00Z');
const item = (n: number, o: { pub?: string; url?: string; type?: string; guid?: string; dur?: string } = {}) =>
  `<item><title>Ep ${n} &amp; more</title><guid isPermaLink="false">${o.guid ?? `g${n}`}</guid><pubDate>${o.pub ?? new Date(NOW.getTime() - n * 86400000).toUTCString()}</pubDate>` +
  `<enclosure url="${o.url ?? `https://traffic.example.com/ep${n}.mp3?x=1&amp;y=2`}" length="0" type="${o.type ?? 'audio/mpeg'}"/>` +
  (o.dur === undefined ? '<itunes:duration>52:17</itunes:duration>' : o.dur ? `<itunes:duration>${o.dur}</itunes:duration>` : '') + `<description><![CDATA[<p>About ep ${n}</p>]]></description></item>`;
const feed = (title: string, items: string[]) => `<?xml version="1.0"?><rss xmlns:itunes="x"><channel><title>${title}</title><itunes:image href="https://img.example.com/a.jpg"/>${items.join('')}</channel></rss>`;
const src = (o: Partial<import('./server/podcasts.ts').PodcastSource> = {}) => ({ id: 't', name: 'Test Show', feedUrl: 'https://feeds.example.com/t', expectTitle: 'Test Show', enabled: true, ...o });

// 1. streamed read stops early: a huge feed is cancelled after the newest items
let pulled = 0; let cancelled = false;
const big = feed('Test Show', Array.from({ length: 5000 }, (_, i) => item(i + 1)));
const enc = new TextEncoder().encode(big);
const stream = new ReadableStream<Uint8Array>({
  pull(c) { if (pulled >= enc.length) { c.close(); return; } const n = Math.min(4096, enc.length - pulled); c.enqueue(enc.slice(pulled, pulled + n)); pulled += n; },
  cancel() { cancelled = true; },
});
const parts = await P.readFeedHead(new Response(stream), 40);
assert.equal(parts.items.length, 40); assert.ok(cancelled, 'download is cancelled after the newest items');
assert.ok(pulled < enc.length / 20, `read only a small part of the feed (${pulled} of ${enc.length})`);

// 2. build state: newest first, entities decoded, direct enclosure URL kept untouched, durations
const st = P.buildState(src(), parts, NOW, 20);
assert.equal(st.status, 'ok'); assert.equal(st.episodes.length, 20);
assert.equal(st.episodes[0].title, 'Ep 1 & more'); assert.equal(st.episodes[0].url, 'https://traffic.example.com/ep1.mp3?x=1&y=2');
assert.equal(st.episodes[0].durationSeconds, 3137); assert.equal(st.episodes[0].description, 'About ep 1'); assert.equal(st.imageUrl, 'https://img.example.com/a.jpg');
const programs = P.toPrograms(st, 'audio-podcasts');
assert.ok(programs.every((p) => p.sourceClass === 'podcast_rss' && p.mediaType === 'audio' && /^https:\/\/traffic\.example\.com\//.test(p.mediaUrl!)), 'direct URLs, never /api/*proxy');
assert.ok(programs.every((p) => !p.mediaUrl!.includes('/api/')));

// 3. wrong feed is rejected, never shown
const wrong = P.buildState(src(), { head: '<channel><title>Some Other Podcast</title>', items: [item(1)] }, NOW);
assert.equal(wrong.status, 'error'); assert.match(wrong.error!, /wrong feed/); assert.equal(wrong.episodes.length, 0);

// 4. rejection reasons are explicit
const mixed = P.buildState(src(), { head: '<channel><title>Test Show</title>', items: [
  item(1, { pub: 'Thu, 01 Jan 1970 00:33:45 GMT' }), item(2, { url: 'http://insecure.example.com/a.mp3' }), item(3, { type: 'text/html', url: 'https://x.example.com/page' }),
  item(4, { pub: 'Fri, 01 Jan 2100 00:00:00 GMT' }), item(5, { guid: 'dup' }), item(6, { guid: 'dup' }), item(7, { dur: '' }),
] }, NOW);
const reasons = mixed.rejected.map((r) => r.reason).join('|');
for (const r of ['invalid pubDate', 'not HTTPS', 'not audio', 'in the future', 'duplicate guid']) assert.ok(reasons.includes(r), r);
assert.equal(mixed.episodes.length, 2, 'only the playable ones are kept');
const noDur = P.toPrograms(mixed, 'audio-podcasts').find((p) => p.metadata!.guid === 'g7')!;
assert.equal(noDur.metadata!.durationSource, 'unknown'); assert.equal(noDur.metadata!.durationEstimated, true);

// 5. oldest-first feed is reported, not passed off as latest
const newestFirst = P.buildState(src(), { head: '<channel><title>Test Show</title>', items: [item(10), item(20), item(30)] }, NOW);
assert.equal(newestFirst.status, 'ok');
const oldestFirst = P.buildState(src(), { head: '<channel><title>Test Show</title>', items: [item(30), item(20), item(10)] }, NOW);
assert.equal(oldestFirst.status, 'degraded'); assert.match(oldestFirst.error!, /oldest episodes first/);

// 6. refresh: HTTP failure keeps last good (degraded); first-time failure is an explicit error; empty is never ok
const s1 = src();
P.setPodcastFetchForTests((async () => new Response(feed('Test Show', [item(1), item(2)]), { status: 200 })) as typeof fetch);
const good = await P.refreshPodcastSource(s1, NOW); assert.equal(good.status, 'ok');
P.setPodcastFetchForTests(undefined);
// failure with no cache first
P.setPodcastFetchForTests((async () => new Response('nope', { status: 503 })) as typeof fetch);
const first = await P.refreshPodcastSource(src({ id: 'new' }), NOW); assert.equal(first.status, 'error'); assert.match(first.error!, /HTTP 503/);
const empty = P.buildState(src(), { head: '<channel><title>Test Show</title>', items: [] }, NOW);
assert.equal(empty.status, 'error');

// 7. guide rows: highlight, stale label, direct URLs, honest error rows
P.setPodcastFetchForTests(undefined);
const reg = P.PODCAST_SOURCES; assert.ok(reg.length >= 9);
const quash = reg.find((s) => s.id === 'quash')!; assert.equal(quash.highlight, 'must-listen'); assert.equal(quash.feedUrl, 'https://feeds.captivate.fm/the-quash/');
assert.ok(reg.every((s) => s.feedUrl.startsWith('https://')) && new Set(reg.map((s) => s.id)).size === reg.length, 'https feeds, unique ids');
assert.ok(!reg.some((s) => s.id.includes('war-room') && s.id === 'war-room'), 'Bannon podcast id never collides with AJN warroom');
const qState = P.buildState(quash, { head: '<channel><title>The Quash</title>', items: [item(1, { pub: 'Sun, 28 Jun 2026 15:00:00 GMT' })] }, NOW);
assert.equal(qState.status, 'ok');
// inject through a real refresh so the cache is populated
P.setPodcastFetchForTests((async (u: any) => new Response(String(u).includes('captivate') ? feed('The Quash', [item(1, { pub: 'Sun, 28 Jun 2026 15:00:00 GMT' })]) : 'x', { status: String(u).includes('captivate') ? 200 : 500 })) as typeof fetch);
await P.refreshPodcastSource(quash, NOW);
const other = reg.find((s) => s.enabled && s.id !== 'quash')!; await P.refreshPodcastSource(other, NOW);
const rows = P.buildPodcastChannels('audio-podcasts', NOW, layoutDailySchedule as any);
const q = rows.find((r) => r.id === 'pod-quash')!;
assert.equal(q.highlight, 'must-listen'); assert.ok(q.programs.length > 0); assert.match(q.group!, /last episode Jun 28/, 'stale show says when its last episode was');
assert.ok(q.programs.filter((p) => p.sourceClass === 'podcast_rss').every((p) => !String(p.mediaUrl).includes('/api/')), 'RSS episodes stay direct');
const ia = q.programs.filter((p) => p.sourceClass === 'archive_org');
assert.ok(ia.length > 0, 'Quash Archive back-catalog is on the channel');
assert.ok(ia.every((p) => String(p.mediaUrl).startsWith('/download/2015-music.-7z/Podcasts/The%20Quash/') && (p as any).archivePath === p.mediaUrl && (p as any).metadata.podcast === true && (p as any).metadata.durationSource === 'archive_metadata' && !(p as any).metadata.airedUtc), 'Archive episodes: encoded Archive path, duration from Archive, no invented air date');
const iaAll = P.archivePrograms(quash, 'audio-podcasts'); assert.equal(iaAll.length, 36); assert.equal(new Set(iaAll.map((p) => p.id)).size, 36, 'unique ids');
assert.deepEqual(P.archivePrograms(reg.find((s) => !s.archiveFolder)!, 'audio-podcasts'), [], 'sources without archiveFolder add nothing');
const e = rows.find((r) => r.id === `pod-${other.id}`)!; assert.equal(e.sourceStatus, 'upstream_error'); assert.match(e.sourceError!, /HTTP 500/); assert.equal(e.programs.length, 0);
assert.ok(rows.find((r) => r.id !== 'pod-quash' && r.sourceStatus === 'loading'), 'sources not fetched yet show a loading row');
assert.equal(rows[0].id, 'pod-quash', 'Quash is first');
assert.equal(P.smallArtwork('https://www.omnycontent.com/d/playlist/a/b/c/image.jpg?t=1&size=Large'), 'https://www.omnycontent.com/d/playlist/a/b/c/image.jpg?t=1&size=Small');
assert.equal(P.smallArtwork('https://artwork.captivate.fm/x.jpg'), 'https://artwork.captivate.fm/x.jpg');
console.log('podcasts: all passed');
