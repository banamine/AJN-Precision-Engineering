import assert from 'node:assert/strict';
import { fetchNowPlaying, type TextFetcher } from './server/radioNowPlaying';
const NOW = Date.parse('2026-10-15T01:10:00Z');
const mk = (cur: string, hist: string | null, curStatus = 200): TextFetcher => async (url) => {
  if (url.includes('metadata.php')) return { status: curStatus, text: cur, lastModified: null };
  if (hist === null) throw new Error('history down');
  return { status: 200, text: hist, lastModified: null };
};
const hist = JSON.stringify({ tracks: [
  { title: 'Heart - Nothin\' At All', played_at: '2026-10-15T01:06:01+00:00' },
  { title: 'Simple Minds - Sanctify Yourself', played_at: '2026-10-15T01:01:01+00:00' },
  { title: 'Classic Hits 109 - ID', played_at: '2026-10-15T00:58:00+00:00' },
  { title: 'The Cars - Bye Bye Love', played_at: '2026-10-15T00:52:01+00:00' } ] });
const cfg = { kind: 'ch109' as const, slug: '70s-80s-90s' };
// current song equals newest history row: not repeated under "recent"
let r = await fetchNowPlaying(cfg, mk('{"songtitle":"Heart - Nothin\' At All"}', hist), NOW);
assert.equal(r.state, 'ok'); assert.equal(r.current?.artist, 'Heart'); assert.equal(r.current?.title, "Nothin' At All");
assert.deepEqual(r.recent.map((x) => x.title), ['Sanctify Yourself', 'Bye Bye Love']); // station ID dropped
assert.equal(r.recent[0].playedLabel, '9 min ago');
// history failing still gives the current song
r = await fetchNowPlaying(cfg, mk('{"songtitle":"A - B"}', null), NOW); assert.equal(r.state, 'ok'); assert.equal(r.recent.length, 0);
// unknown station / bad json / http error / no separator / bad slug: explicit, never invented
assert.equal((await fetchNowPlaying(cfg, mk('{"error":"Unknown station"}', hist), NOW)).state, 'none');
assert.equal((await fetchNowPlaying(cfg, mk('<html>', hist), NOW)).state, 'error');
assert.equal((await fetchNowPlaying(cfg, mk('{}', hist, 500), NOW)).state, 'error');
assert.equal((await fetchNowPlaying(cfg, mk('{"songtitle":"No separator here"}', hist), NOW)).state, 'none');
assert.equal((await fetchNowPlaying({ kind: 'ch109', slug: '../x' }, mk('{}', hist), NOW)).state, 'error');
// an ad/ID published as the song is not shown as a song
assert.equal((await fetchNowPlaying(cfg, mk('{"songtitle":"Classic Hits 109 - classichits109.com"}', hist), NOW)).state, 'none');
console.log('PASS ch109 now-playing adapter');
