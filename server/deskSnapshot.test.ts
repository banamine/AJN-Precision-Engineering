import assert from 'node:assert';
import { isValidFeed, freshest, mergeFeeds, ageDays, thumbFileName, THUMB_NAME_RE } from './deskSnapshot';
import { makeSnapshot, type SnapshotFs } from './deskSnapshotBuild';
import type { DeskFeed, DeskItem } from './desk';

const item = (id: string, beat = 'ufo', type: 'story' | 'scan' = 'story'): DeskItem => ({ id, archiveId: id, beat, cardType: type, headline: 'H ' + id, lead: type === 'story' ? 'Lead sentence here.' : null, source: 'S', year: 1970, yearNote: null, pages: 3, confidence: { label: '90% OCR', tone: 'pass', mean: 90, basis: 'ocr' }, thumbUrl: `https://archive.org/download/${id}/page/n0_w400.jpg`, pageUrl: 'https://archive.org/x', rawOcr: 'x' });
const feed = (ids: string[], at: string): DeskFeed => ({ generatedAt: at, source: 's', beats: [], count: ids.length, queryErrors: 0, items: ids.map((i) => item(i)) });
const meta = [{ id: 'ufo', label: 'UFO files', enabled: true }, { id: 'fbi', label: 'FBI', enabled: false }];

assert.ok(isValidFeed(feed(['a'], '2026-11-01T00:00:00Z')));
assert.ok(!isValidFeed(feed([], '2026-11-01T00:00:00Z')), 'empty is not valid');
assert.ok(!isValidFeed({ ...feed(['a'], 'nope') }), 'bad date');
assert.ok(!isValidFeed({ ...feed(['a'], '2026-11-01T00:00:00Z'), items: [{ id: 'a' }] }), 'bad item');
assert.equal(freshest([feed(['a'], '2026-11-01T00:00:00Z'), feed(['b'], '2026-11-10T00:00:00Z'), null])!.items[0].id, 'b');
assert.equal(freshest([null, { bad: 1 } as any]), null);
assert.equal(ageDays(feed(['a'], '2026-11-01T00:00:00Z'), new Date('2026-11-24T00:00:00Z')), 23);
const m = mergeFeeds(feed(['old1', 'dup'], '2026-11-01T00:00:00Z'), feed(['new1', 'dup'], '2026-11-24T00:00:00Z'), meta);
assert.deepEqual(m.items.map((i) => i.id), ['new1', 'dup', 'old1']); assert.equal(m.count, 3);
assert.equal(m.beats.find((b) => b.id === 'ufo')!.count, 3); assert.equal(m.beats.find((b) => b.id === 'fbi')!.enabled, false);
assert.ok(THUMB_NAME_RE.test(thumbFileName('a b/../c')) && !thumbFileName('a b/../c').includes('/'));

// makeSnapshot with a fake Archive and an in-memory disk
const files = new Map<string, Uint8Array>();
const mfs: SnapshotFs = { read: async (p) => files.get(p) ?? null, write: async (p, d) => { files.set(p, typeof d === 'string' ? new TextEncoder().encode(d) : d); }, exists: async (p) => files.has(p) };
const jpeg = new Uint8Array(1200); jpeg[0] = 0xff; jpeg[1] = 0xd8;
const hocr = (c: number) => `<span class='ocrx_word' title='bbox 0 0 1 1; x_wconf ${c}'>word</span> `.repeat(80);
const prose = 'The committee reviewed the evidence carefully and concluded that the reported sightings could not be explained by any known aircraft or natural phenomenon in the region. ';
let fail = false;
const fakeFetch = (async (url: any) => {
  const u = String(url);
  if (u.includes('advancedsearch')) return new Response(JSON.stringify({ response: { docs: [{ identifier: 'doc1', title: 'Sighting Report Summary', date: '1967-01-01', collection: ['project-blue-book'] }, { identifier: 'doc2', title: 'Another Report Of Events', date: '1968-01-01', collection: ['project-blue-book'] }] } }), { status: 200 });
  if (u.includes('/page/n0_w400.jpg')) return fail ? new Response('no', { status: 404 }) : new Response(jpeg, { status: 200 });
  if (u.includes('/metadata/')) { const id = u.split('/metadata/')[1]; return new Response(JSON.stringify({ metadata: { identifier: id, title: 'Sighting Report Summary', date: '1967-01-01', language: 'eng', imagecount: '4', collection: ['project-blue-book'] }, files: [{ name: id + '_hocr.html', format: 'hOCR', size: '1000' }, { name: id + '_djvu.txt', format: 'DjVuTXT', size: '1000' }] }), { status: 200 }); }
  if (u.includes('_hocr.html')) return new Response(hocr(92), { status: 200 });
  if (u.includes('_djvu.txt')) return new Response(prose.repeat(6), { status: 200 });
  return new Response('nope', { status: 404 });
}) as typeof fetch;
const lib = [{ identifier: 'project-blue-book', name: 'Project Blue Book' }];
(async () => {
  const r = await makeSnapshot({ fetchImpl: fakeFetch, lib, fs: mfs, perBeat: 2, maxAttempts: 4, now: () => new Date('2026-11-24T10:00:00Z') });
  assert.ok(r.feed.count >= 1, 'built cards'); assert.ok(files.has('desk/desk.json'), 'json written');
  const saved = JSON.parse(new TextDecoder().decode(files.get('desk/desk.json')!));
  assert.ok(isValidFeed(saved)); assert.ok(saved.items.every((i: DeskItem) => i.thumbUrl.startsWith('/desk/thumbs/')), 'thumbs point at local files');
  assert.ok([...files.keys()].some((k) => k.startsWith('desk/thumbs/')), 'thumb files written');
  assert.equal(r.thumbsFailed, 0);
  const before = files.get('desk/desk.json')!;
  // a second run that finds NOTHING must throw and leave the good snapshot alone
  const empty = (async (u: any) => (String(u).includes('advancedsearch') ? new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 }) : new Response('x', { status: 404 }))) as typeof fetch;
  await assert.rejects(() => makeSnapshot({ fetchImpl: empty, lib, fs: mfs }), /no cards/);
  assert.equal(files.get('desk/desk.json'), before, 'snapshot untouched after a failed run');
  // thumbnails failing keeps the card with its live address
  files.clear(); fail = true;
  const r2 = await makeSnapshot({ fetchImpl: fakeFetch, lib, fs: mfs, perBeat: 2, maxAttempts: 4 });
  assert.ok(r2.thumbsFailed >= 1 && r2.feed.items.every((i) => i.thumbUrl.startsWith('https://archive.org/')), 'failed thumbs keep live address');
  console.log('deskSnapshot tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
