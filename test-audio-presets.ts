// Audio preset banks (Archive Music / Concerts / Podcasts) and the Listen catalog: pure-function checks.
import assert from 'node:assert/strict';
import { AUDIO_PRESETS_KEY, clearAudioPreset, loadAudioPresets, saveAudioPreset } from './src/utils/audioPresets.ts';
import { buildMusicItems, buildPodcastItems, filterListenItems, listenGenres, loadConcertItems } from './src/utils/listenCatalog.ts';

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
console.log('[audio-presets+listen-catalog] PASS');
