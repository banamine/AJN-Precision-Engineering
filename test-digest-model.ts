import assert from 'node:assert/strict';
import { AJN_DIGEST_FEEDS, DIGEST_LIMIT, LIBRARY_PER_CATEGORY, NEW_PER_SHOW, NEW_WINDOW_MS, ageLabel, buildDigest, cardFromFeedItem, cardFromLibrary, plainText, type DigestCard, type FeedItemWire } from './src/home/digestModel.ts';

const NOW = Date.parse('2026-10-14T20:00:00Z');
const H = 3600_000;
const feed = AJN_DIGEST_FEEDS[0];
const item = (over: Partial<FeedItemWire> = {}): FeedItemWire => ({ id: 'a1', title: 'Show', url: 'https://rss.example.org/a.mp4', mediaType: 'video', publishedAt: new Date(NOW - 2 * H).toISOString(), ...over });

// ---- feed items: only trustworthy NEW material becomes a card
assert.ok(cardFromFeedItem(feed, item(), NOW), 'good item accepted');
assert.equal(cardFromFeedItem(feed, item({ url: 'http://x.org/a.mp4' }), NOW), null, 'http rejected');
assert.equal(cardFromFeedItem(feed, item({ url: undefined }), NOW), null);
assert.equal(cardFromFeedItem(feed, item({ mediaType: undefined }), NOW), null, 'media type is never guessed');
assert.equal(cardFromFeedItem(feed, item({ publishedAt: 'garbage' }), NOW), null, 'bad date rejected, not defaulted to now');
assert.equal(cardFromFeedItem(feed, item({ publishedAt: undefined }), NOW), null);
assert.equal(cardFromFeedItem(feed, item({ publishedAt: new Date(NOW + 5 * H).toISOString() }), NOW), null, 'future date rejected');
assert.equal(cardFromFeedItem(feed, item({ publishedAt: new Date(NOW - NEW_WINDOW_MS - 1000).toISOString() }), NOW), null, 'older than the window is not NEW');
assert.ok(cardFromFeedItem(feed, item({ publishedAt: new Date(NOW - NEW_WINDOW_MS + 1000).toISOString() }), NOW), 'inside the window');
assert.equal(cardFromFeedItem(feed, item({ id: undefined }), NOW), null);
const enc = cardFromFeedItem(feed, item({ title: '&lt;a href=&quot;https://news.google.com/x&quot;&gt;Real &amp;amp; Title&lt;/a&gt;' }), NOW)!;
assert.equal(enc.title, 'Real & Title'); assert.ok(!/[<>]|href|&lt;/.test(enc.title), 'no markup leaks into a title');
assert.equal(plainText(undefined), ''); assert.equal(plainText('<b>x</b>'), 'x');
assert.equal(enc.tier, 'new'); assert.equal(enc.channelId, 'ajn-feed-alex'); assert.equal(enc.guideId, 'audio-podcasts');

// ---- age label is truthful
assert.equal(ageLabel(NOW - 10 * 60_000, NOW), 'just now'); assert.equal(ageLabel(NOW - 3 * H, NOW), '3 h ago');
assert.equal(ageLabel(NOW - 24 * H, NOW), '1 day ago'); assert.equal(ageLabel(NOW - 60 * H, NOW), '3 days ago'); assert.equal(ageLabel(NOW + H, NOW), 'just now');

// ---- fixtures
const fresh: DigestCard[] = [];
const feeds = AJN_DIGEST_FEEDS;
feeds.forEach((f, fi) => { for (let i = 0; i < 10; i++) { const c = cardFromFeedItem(f, item({ id: `${f.id}-${i}`, mediaType: f.id === 'AJNHourlyAudio' ? 'audio' : 'video', publishedAt: new Date(NOW - (fi * 7 + i * 5 + 1) * H / 2).toISOString() }), NOW); if (c) fresh.push(c); } });
assert.ok(fresh.length >= 20);
const cats = ['documentaries', 'otr', 'cinema', 'cartoons', 'books', 'news', 'scifi', 'edu'];
const lib: DigestCard[] = [];
for (let i = 0; i < 160; i++) lib.push(cardFromLibrary({ key: `lib${i}`, categoryId: cats[i % cats.length], categoryLabel: cats[i % cats.length].toUpperCase(), title: `Show ${i}`, subtitle: '', mediaType: i % 3 === 0 ? 'audio' : 'video', path: `/download/lib${i}/f.mp4`, channelId: 'library-x', guideId: 'library', programId: `lib${i}` }));

const run = (over: Partial<Parameters<typeof buildDigest>[0]> = {}) => buildDigest({ fresh, library: lib, seed: 'S1', nowMs: NOW, dismissed: [], ...over });

// ---- NEW first, newest first, capped per show
const d = run();
assert.equal(d.length, DIGEST_LIMIT);
const firstLib = d.findIndex((c) => c.tier === 'library');
assert.ok(firstLib > 0, 'new cards exist and come first');
assert.ok(d.slice(0, firstLib).every((c) => c.tier === 'new') && d.slice(firstLib).every((c) => c.tier === 'library'), 'no new card after a library card');
const news = d.slice(0, firstLib);
for (let i = 1; i < news.length; i++) assert.ok(news[i - 1].publishedMs! >= news[i].publishedMs!, 'newest first');
for (const f of feeds) assert.ok(news.filter((c) => c.showLabel === f.name).length <= NEW_PER_SHOW, `${f.name} capped`);
assert.equal(news.length, feeds.length * NEW_PER_SHOW, 'every show shows up, 3 each');

// ---- backfill: whole library, both media types, category cap, no duplicates
const back = d.slice(firstLib);
assert.ok(back.some((c) => c.mediaType === 'audio') && back.some((c) => c.mediaType === 'video'), 'audio and video both present');
const catCount = new Map<string, number>(); for (const c of back) catCount.set(c.categoryId, (catCount.get(c.categoryId) ?? 0) + 1);
assert.ok([...catCount.values()].every((n) => n <= LIBRARY_PER_CATEGORY), 'category cap');
assert.equal(new Set(d.map((c) => c.key)).size, d.length, 'no duplicate keys');
const firstTwo = back.slice(0, 2).map((c) => c.mediaType); assert.notEqual(firstTwo[0], firstTwo[1], 'media types alternate');

// the cap must actually bind: two categories only -> at most 2 x LIBRARY_PER_CATEGORY library cards, never padded past the cap
const two = buildDigest({ fresh: [], library: lib.filter((c) => c.categoryId === 'otr' || c.categoryId === 'news'), seed: 's', nowMs: NOW, dismissed: [] });
assert.equal(two.length, 2 * LIBRARY_PER_CATEGORY, 'category cap binds');

// ---- determinism and seeding
assert.deepEqual(run().map((c) => c.key), d.map((c) => c.key), 'same inputs, same digest');
const other = run({ seed: 'S2' });
assert.deepEqual(other.slice(0, firstLib).map((c) => c.key), news.map((c) => c.key), 'seed never changes the NEW part');
assert.notDeepEqual(other.slice(firstLib).map((c) => c.key), back.map((c) => c.key), 'a new seed reshuffles the backfill');
const tomorrow = run({ nowMs: NOW + 24 * H, fresh: [] });
assert.notDeepEqual(tomorrow.map((c) => c.key), run({ fresh: [] }).map((c) => c.key), 'order changes with the local day');
const shuffledInput = run({ library: [...lib].reverse() });
assert.deepEqual(shuffledInput.map((c) => c.key), d.map((c) => c.key), 'input order does not matter');

// ---- dismissed / excluded / no input mutation
const dismissed = d.slice(0, 3).map((c) => c.key).concat(d.slice(firstLib, firstLib + 2).map((c) => c.key));
const d2 = run({ dismissed }); assert.ok(d2.every((c) => !dismissed.includes(c.key)), 'dismissed never returns'); assert.equal(d2.length, DIGEST_LIMIT, 'still full');
const ex = new Set(back.slice(0, 4).map((c) => c.key)); assert.ok(run({ exclude: ex }).every((c) => !ex.has(c.key)), 'row 2 picks excluded');
const snapshot = JSON.stringify(lib); run(); assert.equal(JSON.stringify(lib), snapshot, 'library input not mutated');

// ---- degraded inputs: honest, never filler
assert.deepEqual(buildDigest({ fresh: [], library: [], seed: 's', nowMs: NOW, dismissed: [] }), [], 'nothing in, nothing out');
const onlyNew = buildDigest({ fresh, library: [], seed: 's', nowMs: NOW, dismissed: [] }); assert.ok(onlyNew.length > 0 && onlyNew.every((c) => c.tier === 'new'), 'library down: only real NEW items');
const onlyLib = buildDigest({ fresh: [], library: lib, seed: 's', nowMs: NOW, dismissed: [] }); assert.equal(onlyLib.length, DIGEST_LIMIT); assert.ok(onlyLib.every((c) => c.tier === 'library'), 'feeds down: library only, nothing labelled NEW');
const audioOnly = buildDigest({ fresh: [], library: lib.filter((c) => c.mediaType === 'audio'), seed: 's', nowMs: NOW, dismissed: [] }); assert.ok(audioOnly.length > 0 && audioOnly.every((c) => c.mediaType === 'audio'));
const stale = fresh.map((c) => ({ ...c, publishedMs: NOW - NEW_WINDOW_MS - H })); assert.ok(buildDigest({ fresh: stale, library: [], seed: 's', nowMs: NOW, dismissed: [] }).length === 0, 'old items are never shown as NEW');
assert.equal(buildDigest({ fresh, library: lib, seed: 's', nowMs: NOW, dismissed: [], limit: 5 }).length, 5, 'limit honoured');

console.log('PASS digest-model');
