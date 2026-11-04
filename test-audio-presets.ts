// Audio preset banks (Archive Music / Concerts / Podcasts) and the Listen catalog: pure-function checks.
import assert from 'node:assert/strict';
import { AUDIO_PRESETS_KEY, clearAudioPreset, loadAudioPresets, saveAudioPreset } from './src/utils/audioPresets.ts';
import { buildMusicItems, buildPodcastItems, buildSpokenItems, filterListenItems, listenGenres, loadConcertItems, loadSpokenItems } from './src/utils/listenCatalog.ts';

const mem: Record<string, string> = {};
const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
const input = { itemId: 'x', title: 'T', src: '/download/x/a.mp3' };

assert.equal(saveAudioPreset('music', 1, input, st).saved, true);
assert.equal(saveAudioPreset('concerts', 5, input, st).saved, true);
assert.equal(saveAudioPreset('podcasts', 3, input, st).saved, true);
assert.equal(saveAudioPreset('live', 1, input, st).saved, false, 'live radio keeps its own v2 store');
assert.equal(saveAudioPreset('music', 6, input, st).saved, false, 'slot 6 does not exist');
assert.equal(saveAudioPreset('music', 2, { ...input, title: '' }, st).saved, false, 'empty title refused');
assert.equal(saveAudioPreset('music', 2, { ...input, src: '' }, st).saved, false, 'empty src refused');
const loaded = loadAudioPresets(st);
assert.deepEqual([Object.keys(loaded.music), Object.keys(loaded.concerts), Object.keys(loaded.podcasts)], [['1'], ['5'], ['3']]);
saveAudioPreset('music', 1, { ...input, title: 'Replaced' }, st);
assert.equal(loadAudioPresets(st).music[1]?.title, 'Replaced');
assert.deepEqual(Object.keys(clearAudioPreset('music', 1, st).music), []);
mem[AUDIO_PRESETS_KEY] = '{not json';
assert.deepEqual(loadAudioPresets(st), { music: {}, concerts: {}, podcasts: {} }, 'corrupt storage starts empty');
mem[AUDIO_PRESETS_KEY] = JSON.stringify([{ bank: 'music', slot: 1, itemId: 'a', title: 'A', src: 's' }, { bank: 'music', slot: 1, itemId: 'b', title: 'B', src: 's' }, { bank: 'nope', slot: 2, itemId: 'c', title: 'C', src: 's' }, { bank: 'music', slot: 9, itemId: 'd', title: 'D', src: 's' }]);
const l2 = loadAudioPresets(st);
assert.equal(l2.music[1]?.itemId, 'a', 'first of duplicate slots wins');
assert.equal(Object.keys(l2.music).length, 1, 'unknown bank / bad slot dropped');

const music = buildMusicItems();
assert.ok(music.items.length >= 40, 'music channels come from archiveAudioChannels + snapshot');
for (const m of music.items) {
  assert.ok(/^(item-)?music-/.test(m.channelId), `${m.id} keeps the music- id the player recognises`);
  const t = m.tracks();
  assert.ok(t.length > 0 && t.length <= 300);
  assert.ok(t.every((x, i) => x.src.startsWith('/download/') && !/[ #?]/.test(x.src) && x.partNo === i + 1 && x.totalParts === t.length), `${m.id} paths are encoded and numbered`);
}
const pods = buildPodcastItems();
assert.ok(pods.length > 0 && pods.every((p) => p.tracks().length === 1 && p.tracks()[0].src.startsWith('/download/')));
const concerts = await loadConcertItems();
assert.ok(concerts.length > 1000);
assert.equal(new Set(concerts.map((c) => c.id)).size, concerts.length, 'concert ids are unique');
assert.ok(concerts.every((c) => c.tracks().every((x) => !/[ #?]/.test(x.src))), 'concert filenames with spaces/#/? are encoded');
assert.ok(filterListenItems(concerts, 'coltrane', '').length >= 1);
assert.ok(filterListenItems(concerts, '', 'Rock').every((c) => c.genre === 'Rock'));
assert.ok(listenGenres(concerts).includes('Jazz & Blues'));
// Podcasts bank from the server's Audio & Podcasts guide (real response saved from the live site).
import { readFileSync } from 'node:fs';
const live = JSON.parse(readFileSync(new URL('./test-fixtures/audio-podcasts-light.json', import.meta.url), 'utf8')) as { channels: any[] };
const sp = buildSpokenItems(live.channels);
assert.ok(sp.items.length > 300, `spoken items ${sp.items.length}`);
assert.equal(new Set(sp.items.map((i) => i.id)).size, sp.items.length, 'spoken ids are unique');
assert.ok(sp.items.every((i) => i.bank === 'podcasts' && i.tracks().length === 1 && i.tracks()[0].src.length > 0));
assert.ok(sp.items.some((i) => i.genre === 'Talk Radio') && sp.items.some((i) => i.genre === 'Old-Time Radio') && sp.items.some((i) => i.genre === 'Podcast'));
assert.ok(sp.feedsDown.length >= 1 && sp.feedsDown.every((f) => f.name && f.reason), 'feeds the server could not read are reported, not faked');
assert.ok(!sp.items.some((i) => sp.feedsDown.some((f) => f.name === i.subtitle)), 'a down feed contributes no fake episodes');
assert.ok(!sp.items.some((i) => i.genre === 'Music' || i.genre === 'Live Concerts'));
const okFetch = (async () => new Response(JSON.stringify(live))) as unknown as typeof fetch;
assert.equal((await loadSpokenItems(okFetch)).items.length, sp.items.length);
await assert.rejects(() => loadSpokenItems((async () => new Response('x', { status: 502 })) as unknown as typeof fetch), /HTTP 502/);
console.log('[audio-presets+listen-catalog] PASS');

// Podcasts list opens with many shows (round-robin), order inside each show kept
{
  const { interleaveByShow } = await import('./src/utils/listenCatalog.ts');
  const mkI = (show: string, n: number) => ({ id: `${show}${n}`, bank: 'podcasts', title: `${show} ${n}`, subtitle: show, genre: 'Podcast', channelId: show, guideId: 'g', tracks: () => [], trackCount: 1 }) as any;
  const mixed = interleaveByShow([...Array.from({ length: 5 }, (_, i) => mkI('Quash', i)), mkI('A', 0), mkI('A', 1), mkI('B', 0)]);
  assert.deepEqual(mixed.slice(0, 3).map((x: any) => x.subtitle), ['Quash', 'A', 'B']);
  assert.deepEqual(mixed.filter((x: any) => x.subtitle === 'Quash').map((x: any) => x.title), ['Quash 0', 'Quash 1', 'Quash 2', 'Quash 3', 'Quash 4']);
  assert.equal(mixed.length, 8);
  console.log('[interleaveByShow] PASS');
}
