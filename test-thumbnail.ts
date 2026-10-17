// Regression: thumbnail resolution (pure functions), episode-frame choice, and the backup image files.
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
const T = await import('./src/utils/thumbnail.ts');
const P = await import('./collections/series-parse.ts');

// identifier parsing: every reference shape the app uses
assert.equal(T.archiveIdentifierFromPath('/download/KolchakTheNightStalker/Bad%20Medicine.mp4'), 'KolchakTheNightStalker');
assert.equal(T.archiveIdentifierFromPath('https://archive.org/download/Taxi1x14SugarMama/Taxi%201x01.mp4'), 'Taxi1x14SugarMama');
assert.equal(T.archiveIdentifierFromPath('/api/archive/proxy?path=%2Fdownload%2Fhogans-heroes-s-01-e-01-the-informer_202509%2Fx.mp4'), 'hogans-heroes-s-01-e-01-the-informer_202509');
assert.equal(T.archiveIdentifierFromPath('https://archive.org/details/The_Fugitive_Series'), 'The_Fugitive_Series');
assert.equal(T.archiveIdentifierFromPath('https://example.com/stream.m3u8'), null);
assert.equal(T.archiveIdentifierFromPath('/download/..%2F..%2Fetc/x'), null, 'path traversal is not an identifier');
assert.equal(T.archiveIdentifierFromPath(''), null);

// urls
assert.equal(T.archiveItemImageUrl('KolchakTheNightStalker'), 'https://archive.org/services/img/KolchakTheNightStalker');
assert.equal(T.archiveFrameUrl('id1', "id1.thumbs/Hogan's Heroes_S01E01_x_000001.jpg"), "https://archive.org/download/id1/id1.thumbs/Hogan's%20Heroes_S01E01_x_000001.jpg");

// chain order: frame, item image, captured, backup
const full = T.thumbCandidates({ identifier: 'id1', frameFile: 'id1.thumbs/a_000009.jpg', guideId: 'classic-tv' }, 'data:image/jpeg;base64,AAAA');
assert.deepEqual(full.map((c) => c.source), ['episode-frame', 'item-image', 'captured', 'backup']);
assert.deepEqual(T.thumbCandidates({ path: '/download/id2/x.mp4' }).map((c) => c.source), ['item-image', 'backup']);
assert.deepEqual(T.thumbCandidates({ path: 'https://example.com/x.m3u8', guideId: 'live-tv' }).map((c) => c.url), ['/thumbs/live.jpg'], 'non-archive source goes straight to the backup image');
assert.deepEqual(T.thumbCandidates({ identifier: 'id1' }, 'javascript:alert(1)').map((c) => c.source), ['item-image', 'backup'], 'only jpeg data URLs are accepted as captured frames');

// backup selection
assert.equal(T.backupThumb({ guideId: 'classic-tv' }), '/thumbs/classic-archive.jpg');
assert.equal(T.backupThumb({ guideId: 'live-tv' }), '/thumbs/live.jpg');
assert.equal(T.backupThumb({ guideId: 'audio-podcasts' }), '/thumbs/audio-podcast.jpg');
assert.equal(T.backupThumb({ category: 'news' }), '/thumbs/special-report.jpg');
assert.equal(T.backupThumb({ category: 'documentary' }), '/thumbs/daily-highlights.jpg');
assert.equal(T.backupThumb({ channelId: 'ajn-alex-jones-live' }), '/thumbs/alex-jones-show.jpg');
assert.equal(T.backupThumb({ channelId: 'emergency-broadcast' }), '/thumbs/emergency-broadcast.jpg');
for (const f of ['classic-archive', 'daily-highlights', 'emergency-broadcast', 'special-report', 'alex-jones-show', 'audio-podcast', 'live']) {
  const p = `public/thumbs/${f}.jpg`; assert.ok(existsSync(p), `${p} exists`); assert.ok(statSync(p).size > 1000 && statSync(p).size < 40_000, `${p} is small`);
}
assert.equal(T.initialsOf('Hogan’s Heroes'), 'HH'); assert.equal(T.initialsOf('Taxi'), 'TA'); assert.equal(T.initialsOf(''), 'TV');

// episode frame: the middle Archive frame for the chosen file (never the first, usually black)
const files = ['id1.thumbs/Ep One_000001.jpg', 'id1.thumbs/Ep One_000235.jpg', 'id1.thumbs/Ep One_000364.jpg', 'id1.thumbs/Ep One_000486.jpg', 'id1.thumbs/Ep Two_000001.jpg', 'Ep One.mp4'].map((name) => ({ name }));
assert.equal(P.pickEpisodeThumb(files, 'id1', 'Ep One.mp4'), 'id1.thumbs/Ep One_000364.jpg');
assert.equal(P.pickEpisodeThumb(files, 'id1', 'Ep One.ia.mp4'), 'id1.thumbs/Ep One_000364.jpg', 'derivative uses the same frames');
assert.equal(P.pickEpisodeThumb(files, 'id1', 'Missing.mp4'), undefined);
console.log('thumbnail regression: all passed');

// ---- music genre fallback ----
{
  const assertEq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', m, JSON.stringify(a), JSON.stringify(b)); process.exit(1); } };
  const mk = (id: string, name: string) => T.thumbCandidates({ identifier: id, guideId: 'audio-podcasts', category: 'Music', mediaType: 'audio', channelId: 'music-x', name });
  // normal music item: real cover first, genre picture after it
  assertEq(mk('SlowRock_201707x', 'slow rock').map((c) => c.source), ['item-image', 'genre', 'backup'], 'music chain');
  assertEq(mk('SlowRock_201707x', 'slow rock')[1].url, '/genre-art/rock.jpg', 'rock art');
  // known no-art item: the Archive cover is skipped entirely
  assertEq(mk('06.-tunnel-13', '06.-tunnel-13').map((c) => c.source), ['genre', 'backup'], 'no-art item skips cover');
  // non-music channels are untouched
  assertEq(T.thumbCandidates({ identifier: 'abc', guideId: 'audio-podcasts', category: 'Old-Time Radio', mediaType: 'audio', name: 'Old-Time Radio' }).map((c) => c.source), ['item-image', 'backup'], 'non-music unchanged');
  console.log('thumbnail music genre: PASS');
}
