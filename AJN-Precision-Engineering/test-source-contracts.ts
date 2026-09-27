// Offline regression for source contracts (layers 0 and 1) and runner isolation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classicM3uContract, parseM3uEntries, episodeKey } from './server/sources/classicM3u.ts';
import { localFilesContract } from './server/sources/localFiles.ts';
import { runSources } from './server/sources/runner.ts';
import type { SourceContract } from './server/sources/contract.ts';

const now = new Date('2026-09-23T12:00:00Z');
const ctx = { now, signal: new AbortController().signal };

// ── Layer 1: Classic TV M3U ────────────────────────────────────────────────
const m3u = `#EXTM3U
#EXTINF:1500 tvg-id="hm" group-title="The Honeymooners",The Honeymooners S01E02 - Funny Money
https://archive.org/download/honeymooners/S01E02.mp4
#EXTINF:1500 group-title="The Honeymooners",The Honeymooners 1x03 TV or Not TV
/download/honeymooners/S01E03.mp4
#EXTINF:1500 group-title="The Honeymooners",The Honeymooners S01E02 duplicate
https://archive.org/download/honeymooners/S01E02-dup.mp4
#EXTINF:-1 group-title="Radio",Old Time Radio
https://example.org/radio.mp3
#EXTINF:60,Bad scheme
ftp://example.org/x.mp4
`;
const entries = parseM3uEntries(m3u);
assert.equal(entries.length, 5);
assert.deepEqual(episodeKey(entries[0]), { show: 'The Honeymooners', season: 1, episode: 2 });
assert.deepEqual(episodeKey(entries[1]), { show: 'The Honeymooners', season: 1, episode: 3 });

const m3uResult = await classicM3uContract.hook({ playlistId: 'p1', guideId: 'classic-tv', text: m3u }, ctx);
assert.equal(m3uResult.sourceClass, 'classic_m3u');
assert.equal(m3uResult.programs.length, 3);
assert.equal(m3uResult.status, 'partial');
assert.deepEqual(m3uResult.rejected.map((r) => r.reason.split(':')[0]).sort(), ['duplicate episode in playlist', 'unsupported URL scheme']);
const radio = m3uResult.programs.find((p) => p.title === 'Old Time Radio');
assert.equal(radio?.mediaType, 'audio');
// Identity is show+episode, not URL: same episode at a new URL keeps its id.
const moved = await classicM3uContract.hook({ playlistId: 'p1', guideId: 'classic-tv', text: m3u.replace('/S01E02.mp4', '/moved/S01E02.mp4') }, ctx);
assert.equal(moved.programs[0].id, m3uResult.programs[0].id);
console.log('PASS classic_m3u');

// ── Layer 0: Local Files ───────────────────────────────────────────────────
const dir = await mkdtemp(path.join(os.tmpdir(), 'ajn-local-'));
await mkdir(path.join(dir, 'Movies'));
await writeFile(path.join(dir, 'Movies', 'Night Film.mp4'), 'x');
await writeFile(path.join(dir, 'song.mp3'), 'x');
await writeFile(path.join(dir, 'old.avi'), 'x');
await writeFile(path.join(dir, 'notes.txt'), 'x');
const local = await localFilesContract.hook({ root: dir, guideId: 'local-files' }, ctx);
assert.equal(local.programs.length, 2);
assert.deepEqual(local.rejected, [{ id: 'old.avi', reason: '.avi is not browser-playable' }]);
const film = local.programs.find((p) => p.title === 'Night Film')!;
assert.equal(film.mediaUrl, '/api/local/media/Movies/Night%20Film.mp4');
assert.equal(film.channelId, 'local:movies');
const again = await localFilesContract.hook({ root: dir, guideId: 'local-files' }, ctx);
assert.equal(again.programs.find((p) => p.title === 'Night Film')!.id, film.id, 'stable identity');
const missing = await localFilesContract.hook({ root: path.join(dir, 'nope'), guideId: 'local-files' }, ctx);
assert.equal(missing.status, 'offline');
await rm(dir, { recursive: true, force: true });
console.log('PASS local_file');

// ── Runner: priority order and isolation ───────────────────────────────────
const order: string[] = [];
const boom: SourceContract<null> = { sourceClass: 'archive_news', priority: 3, async hook() { order.push('news'); throw new Error('Archive down'); } };
const hang: SourceContract<null> = { sourceClass: 'ajn_audio', priority: 4, hook: () => { order.push('audio'); return new Promise(() => {}); } };
const fine: SourceContract<null> = {
  sourceClass: 'ajn_media', priority: 5,
  async hook(_i, c) { order.push('media'); return { sourceClass: 'ajn_media', status: 'ok', programs: [], rejected: [], fetchedAt: c.now.toISOString() }; },
};
const results = await runSources([
  { contract: fine, input: null },
  { contract: hang, input: null },
  { contract: boom, input: null },
  { contract: classicM3uContract, input: { playlistId: 'p1', guideId: 'classic-tv', text: m3u } },
], { now, timeoutMs: 200 });
assert.deepEqual(order, ['news', 'audio', 'media']);
assert.deepEqual(results.map((r) => [r.sourceClass, r.status]), [
  ['classic_m3u', 'partial'],
  ['archive_news', 'offline'],
  ['ajn_audio', 'offline'],
  ['ajn_media', 'ok'],
]);
assert.equal(results[1].error, 'Archive down');
assert.match(results[2].error ?? '', /timed out/);
console.log('PASS runner isolation');
console.log('source contracts regression: all passed');
