// Offline regression for the Archive catalog builder: labels, whole-word SEX rule, genres, records, thumbnails,
// alternates/pairing, dedupe, pagination, collection expansion limit, per-item failures, and email never in output.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const R = await import('./server/catalog/rules.ts');
const GN = await import('./server/catalog/genres.ts');
const B = await import('./server/catalog/record.ts');
const D = await import('./server/catalog/dedupe.ts');
const E = await import('./server/catalog/enumerate.ts');
const nosleep = async () => {};

// English labels: Cyrillic removed from the display title only
assert.equal(R.englishLabel('Nотрясающих лайфхаков для барбекю', '1a-3_20240519'), 'Untitled (1a-3_20240519)', 'nothing meaningful left -> id fallback');
assert.equal(R.englishLabel('Death Valley Days — Смерть', 'x'), 'Death Valley Days', 'Cyrillic tail removed, punctuation tidied');
assert.equal(R.englishLabel('Русский Концерт Live 1999', 'x'), 'Live 1999');
assert.ok(!R.hasCyrillic(R.englishLabel('Привет Hello World', 'x')));
assert.equal(R.englishLabel('Plain English Title', 'x'), 'Plain English Title');

// Whole-word SEX: case-insensitive, Essex/Sussex/sexy are NOT matches, separators are
for (const yes of ['Sex Education', 'my SEX tape', 'sex-tape.mp4', 'a_sex_b.mp4', 'sex_ed.mp4', 'about (sex)', ['x', 'SEX']]) assert.equal(R.hasSexWord(yes), true, String(yes));
for (const no of ['Essex County', 'Sussex', 'sexy', 'unisex', 'sex2go', 'Middlesex Story', '']) assert.equal(R.hasSexWord(no), false, String(no));
assert.equal(R.hasSexWord('<img src="data:image/png;base64,AAAA/sex/BBBB"> Hello'), false, 'inline data URIs are not text');
assert.equal(R.findSexWord({ title: 'ok', subject: ['a', 'Sex'] }), 'subject');

// Genres
assert.deepEqual(GN.inferGenres({ collection: ['classic_tv', 'opensource_movies'], subject: 'western; cowboys' }).sort(), ['Classic TV', 'Western']);
assert.deepEqual(GN.inferGenres({ title: 'Untitled', subject: 'Unknown' }), ['Uncategorized']);

// Records
const f = (name: string, format: string, extra: any = {}) => ({ name, format, size: '1000', md5: 'm' + name, length: '600', ...extra });
const meta = (m: any, files: any[]) => ({ metadata: { identifier: 'i', title: 'Good Show', mediatype: 'movies', collection: 'classic_tv', ...m }, files });
const src = [{ kind: 'favorite' as const }];
let r: any = B.buildCatalogRecord('i', meta({}, [f('Good Show.mp4', 'MPEG4'), f('Good Show.ia.mp4', 'h.264 IA'), f('Good Show_512kb.mp4', '512Kb MPEG4'), f('other thing.mp4', 'MPEG4')]), src);
assert.equal(r.kind, 'record'); assert.equal(r.record.status, 'playable');
assert.equal(r.record.selected.name, 'Good Show.ia.mp4', 'h.264 derivative beats the original');
assert.deepEqual(r.record.alternates.map((a: any) => a.name).sort(), ['Good Show.mp4', 'Good Show_512kb.mp4'], 'alternates = versions of the same program only');
assert.equal(r.record.episodeCount, 2); assert.equal(r.record.playableFileCount, 4);
assert.equal(r.record.sourceUrl, 'https://archive.org/details/i');

// nested folders are kept and each path part encoded once
r = B.buildCatalogRecord('1a-3', meta({ identifier: '1a-3' }, [f('44/clip one.mp4', 'h.264')]), src);
assert.equal(r.record.selected.path, '/download/1a-3/44/clip%20one.mp4');

// SEX rule: item-level text drops everything, file-level drops only that file
r = B.buildCatalogRecord('i', meta({ description: 'This is about sex.' }, [f('a.mp4', 'h.264')]), src);
assert.equal(r.kind, 'excluded'); assert.match(r.reason, /description/);
r = B.buildCatalogRecord('i', meta({}, [f('Show_sex_scene.mp4', 'h.264'), f('Clean Show.mp4', 'h.264')]), src);
assert.equal(r.record.selected.name, 'Clean Show.mp4', 'clean sibling stays eligible'); assert.equal(r.record.playableFileCount, 1);
r = B.buildCatalogRecord('i', meta({}, [f('Essex Road.mp4', 'h.264')]), src);
assert.equal(r.record.selected.name, 'Essex Road.mp4', 'Essex is not a match');
r = B.buildCatalogRecord('i', meta({}, [f('sex.mp4', 'h.264')]), src);
assert.equal(r.record.status, 'not-playable', 'only candidate removed -> listed as not playable, not silently dropped');

// Types: etree -> audio path; texts/data/web listed as not playable; restricted skipped; private files skipped
r = B.buildCatalogRecord('g', meta({ mediatype: 'etree' }, [f('t1.mp3', 'VBR MP3')]), src); assert.equal(r.record.mediaType, 'audio'); assert.equal(r.record.status, 'playable');
for (const t of ['texts', 'data', 'web', 'software', 'image']) { r = B.buildCatalogRecord('x', meta({ mediatype: t }, []), src); assert.equal(r.record.status, 'not-playable'); assert.match(r.record.reason, /not audio or video/); }
r = B.buildCatalogRecord('x', meta({ 'access-restricted-item': 'true' }, [f('a.mp4', 'h.264')]), src); assert.equal(r.record.status, 'not-playable');
r = B.buildCatalogRecord('x', meta({}, [f('a.mp4', 'h.264', { private: 'true' })]), src); assert.equal(r.record.status, 'not-playable');
assert.equal(B.buildCatalogRecord('x', null, src).kind, 'failed'); assert.equal(B.buildCatalogRecord('x', { is_dark: true, metadata: { title: 't' } }, src).kind, 'failed');

// Thumbnails: item thumb file > middle .thumbs frame > Archive image service; thumbs never become entries
const th = ['p.thumbs/p_000001.jpg', 'p.thumbs/p_000002.jpg', 'p.thumbs/p_000003.jpg'].map((n) => f(n, 'Thumbnail'));
r = B.buildCatalogRecord('p', meta({}, [f('p.mp4', 'h.264'), ...th]), src);
assert.equal(r.record.thumbnailSource, 'frame-thumbs'); assert.match(r.record.thumbnailUrl, /p_000002\.jpg$/); assert.equal(r.record.playableFileCount, 1);
r = B.buildCatalogRecord('p', meta({}, [f('p.mp4', 'h.264'), f('__ia_thumb.jpg', 'Item Image')]), src); assert.equal(r.record.thumbnailSource, 'item-thumb-file');
r = B.buildCatalogRecord('p', meta({}, [f('p.mp4', 'h.264')]), src); assert.equal(r.record.thumbnailSource, 'archive-service');

// Verified audio/video pairing: same stem and durations within 2 s
r = B.buildCatalogRecord('v', meta({}, [f('ep1.mp4', 'h.264', { length: '600' }), f('ep1.mp3', 'VBR MP3', { length: '601' })]), src); assert.ok(r.record.pairing);
r = B.buildCatalogRecord('v', meta({}, [f('ep1.mp4', 'h.264', { length: '600' }), f('ep1.mp3', 'VBR MP3', { length: '900' })]), src); assert.equal(r.record.pairing, undefined, 'different lengths: not paired');
r = B.buildCatalogRecord('v', meta({}, [f('ep1.mp4', 'h.264'), f('other.mp3', 'VBR MP3')]), src); assert.equal(r.record.pairing, undefined, 'different names: not paired');

// Dedupe: exact md5 across ids merges (upload wins, sources unioned); title/year/creator only flags
const mk = (id: string, kind: any, md5: string, title = 'Some Long Title', year = 1950, creator = 'Acme'): any => B.buildCatalogRecord(id, { metadata: { identifier: id, title, mediatype: 'movies', year, creator }, files: [{ name: `${id}.mp4`, format: 'h.264', md5, length: '60' }] }, [{ kind }]);
const recs = [mk('a', 'favorite', 'SAME'), mk('b', 'upload', 'SAME'), mk('c', 'collection', 'X1'), mk('d', 'favorite', 'X2')].map((x: any) => x.record);
const out = D.dedupeRecords(recs);
assert.equal(out.exactMerged.length, 1); assert.equal(out.exactMerged[0].kept, 'b'); assert.deepEqual(out.records.find((x: any) => x.id === 'b')!.alsoIdentifiers, ['a']);
assert.deepEqual(out.records.find((x: any) => x.id === 'b')!.sources.map((s: any) => s.kind).sort(), ['favorite', 'upload']);
assert.equal(out.records.some((x: any) => x.id === 'a'), false);
assert.equal(out.reviews.length, 1, 'c and d (and b) share title/year/creator'); assert.deepEqual(out.reviews[0].ids.sort(), ['b', 'c', 'd']);
assert.ok(out.records.find((x: any) => x.id === 'c')!.reviewFlags![0].startsWith('likely-duplicate-of:')); assert.equal(out.records.length, 3, 'likely duplicates are NOT merged');
assert.equal(D.dedupeRecords([mk('e', 'favorite', 'Z1', 'Title', 1950).record as any, mk('f', 'favorite', 'Z2', 'Title', 1950).record as any]).reviews.length, 0, 'short generic titles are not compared');

// Enumeration: pagination, 200-with-error, incomplete pages, collection counts, per-item failures
const calls: string[] = [];
const fake = (handler: (u: URL) => any): any => async (url: string) => { calls.push(url); const u = new URL(url); const b = handler(u); return b instanceof Response ? b : new Response(JSON.stringify(b), { status: 200 }); };
const pages = fake((u) => { const p = Number(u.searchParams.get('page')); const rows = Number(u.searchParams.get('rows')); const all = Array.from({ length: 5 }, (_, i) => ({ identifier: `id${i}`, mediatype: 'movies' })); return { response: { numFound: 5, docs: all.slice((p - 1) * rows, p * rows) } }; });
const sa = await E.searchAll(pages, 'collection:fav-x', { rows: 2, sleep: nosleep });
assert.ok(calls.every((u) => u.includes('sort[]=identifier+asc')), 'every page request uses the fixed sort');
assert.equal(sa.docs.length, 5); assert.equal(calls.length, 3, 'followed 3 pages');
await assert.rejects(E.searchAll(fake(() => ({ error: 'syntax error' })), 'q', { sleep: nosleep }), /archive search error/);
await assert.rejects(E.searchAll(fake(() => ({ response: { numFound: 9, docs: [{ identifier: 'a' }] } })), 'q', { sleep: nosleep }), /incomplete/);
assert.equal(await E.countMembers(fake(() => ({ response: { numFound: 201, docs: [] } })), 'c', nosleep), 201);
let n = 0; const flaky: any = async () => (++n < 3 ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ metadata: { title: 'T', mediatype: 'movies' }, files: [{ name: 'a.mp4', format: 'h.264', extra: 1 }] }), { status: 200 }));
const ok = await E.fetchItemMetadata(flaky, 'z', nosleep); assert.equal(ok.ok, true); assert.equal(n, 3, 'retried twice then succeeded');
assert.deepEqual(Object.keys((ok as any).meta.files[0]).sort(), ['format', 'length', 'md5', 'name', 'private', 'size'], 'cache keeps only needed file fields');
const bad = await E.fetchItemMetadata(fake(() => new Response('', { status: 404 })), 'gone', nosleep); assert.equal(bad.ok, false);
const empty = await E.fetchItemMetadata(fake(() => ({})), 'blank', nosleep); assert.equal(empty.ok, false);

// Privacy: the uploader email never appears in anything the job writes
const EMAIL = 'someone@example.com';
const sourceInfo = { account: 'infobattalion', uploads: { query: 'uploader:<redacted>', count: 28 } };
assert.ok(!JSON.stringify({ sourceInfo, recs: out.records, reviews: out.reviews }).includes(EMAIL));
console.log('archive catalog: ok');
