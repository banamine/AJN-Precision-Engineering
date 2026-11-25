// Offline contract: only browser-playable video is admitted to guides and the Library.
// Regression for the live runtime log: Classic TV .avi (Home Improvement, How It's Made), .mkv, .mpg,
// .m3u/.nfo and folder links, and Library picking an original MPEG4 over its H.264 derivative
// (The_Haunted_Castle_1896 -> DEMUXER_ERROR_NO_SUPPORTED_STREAMS).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mediaExtension, notWebPlayableVideo } from './server/sources/archiveLinks.ts';
import { selectPlayableFile } from './server/archive/mediaSelector.ts';

// Admission predicate
for (const ok of ['/download/a/b.mp4', '/download/a/b.M4V', '/download/a/b.webm?x=1', 'https://x/y/playlist.m3u8',
  '/api/archive/proxy?path=%2Fdownload%2Fa%2Fb%2520c.mp4', '/download/a/b.mp4?exact=1&start=0&end=282'])
  assert.equal(notWebPlayableVideo(ok), null, `${ok} must be admitted`);
for (const bad of ['/download/a/b.avi', '/download/a/b.mkv', '/download/a/b.mpg', '/download/a/b.mov', '/download/a/b.m3u',
  '/download/a/b.nfo', '/download/fox5news911/', '/api/archive/proxy?path=%2Fdownload%2Fa%2Fb.avi', ''])
  assert.ok(notWebPlayableVideo(bad), `${JSON.stringify(bad)} must be rejected`);
assert.equal(mediaExtension('/download/a/Home%20Improvement%20-%20109.avi'), 'avi');

// Selector: H.264 derivatives beat the uploader's original MPEG4 (Haunted Castle shape), original is last resort.
const castle = [
  { name: 'Castle.mp4', format: 'MPEG4', source: 'original' },
  { name: 'Castle.ogv', format: 'Ogg Video', source: 'derivative' },
  { name: 'Castle_512kb.mp4', format: '512Kb MPEG4', source: 'derivative' },
];
assert.equal(selectPlayableFile('Castle', castle, undefined, 'video').filename, 'Castle_512kb.mp4', 'derivative must beat original MPEG4');
assert.equal(selectPlayableFile('Castle', [castle[0]], undefined, 'video').filename, 'Castle.mp4', 'original is still used when it is the only choice');
assert.equal(selectPlayableFile('x', [{ name: 'a.mp4', format: 'MPEG4' }, { name: 'a_h264.mp4', format: 'h.264' }], undefined, 'video').filename, 'a_h264.mp4');

// Packaged data: nothing the browser cannot demux ships in the snapshots.
const classic = JSON.parse(readFileSync(new URL('./src/data/classicSnapshot.json', import.meta.url), 'utf8'));
const badClassic = classic.programs.filter((p: any) => notWebPlayableVideo(p.archivePath ?? p.mediaUrl));
assert.deepEqual(badClassic.map((p: any) => p.archivePath), [], `classicSnapshot has ${badClassic.length} unplayable programs`);
assert.ok(classic.programs.length > 1000, 'classic snapshot must still hold its playable programs');
const lib = JSON.parse(readFileSync(new URL('./src/data/libraryIndex.json', import.meta.url), 'utf8'));
const badLib = lib.items.filter((i: any) => i.mediaType === 'video' && notWebPlayableVideo(i.path));
assert.deepEqual(badLib.map((i: any) => i.path), [], 'libraryIndex video items must all be web-playable files');
const castleItem = lib.items.find((i: any) => i.identifier === 'The_Haunted_Castle_1896');
assert.ok(!castleItem || /_512kb\.mp4$/.test(castleItem.path), 'Haunted Castle must use the H.264 derivative');

console.log('playable admission contract: all passed');
