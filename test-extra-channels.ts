import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import { notWebPlayableVideo } from './server/sources/archiveLinks';
import { MOVIES_CLASSICS_PARTITION_PREFIX, resolveMoviesClassicChannelAlias } from './server/moviesClassicsSchedule';
import manifest from './src/data/extraChannelsManifest.json';

const m = manifest as any;
assert.equal(m.schema, 'ajn.extraChannelsManifest.v1');
const sourceRowsBefore = JSON.stringify(m.channels);
for (const c of m.channels) {
  const ids = new Set<string>(), paths = new Set<string>();
  for (const r of c.rows) {
    assert.ok(r.durationSeconds >= 30, `${c.id}: real runtime`);
    assert.ok(!ids.has(r.id) && !paths.has(r.identifier + '/' + r.file), `${c.id}: no duplicate rows`);
    ids.add(r.id); paths.add(r.identifier + '/' + r.file);
    assert.equal(notWebPlayableVideo(`/download/${r.identifier}/${r.file.split('/').map(encodeURIComponent).join('/')}`), null, `${r.file} web-playable`);
  }
}
const d1 = new Date('2026-10-08T12:00:00Z'), d2 = new Date('2026-10-09T12:00:00Z');
const cable = await getScheduleForGuide('cable-tv', d1);
for (const [id, name] of [['ajn-infowars-nightly-news', 'INFOWARS NIGHTLY NEWS'], ['ajn-infowars-survival', 'INFO WARS SURVIVAL']]) {
  const ch = cable.find((c) => c.id === id)!; assert.ok(ch, `${id} on Cable TV`); assert.equal(ch.name, name); assert.equal(ch.group, 'News');
  assert.equal(ch.programs[0].startHour, 0); assert.ok(Math.abs(ch.programs.at(-1)!.endHour! - 24) < 1e-6, `${id} fills the day`);
  const next = (await getScheduleForGuide('cable-tv', d2)).find((c) => c.id === id)!;
  assert.notEqual(ch.programs[0].title, next.programs[0].title, `${id} rotates tomorrow`);
}
assert.ok(cable.some((c) => c.id === 'rt-documentaries' || c.group === 'News'), 'existing cable news channels untouched');
assert.ok(!(await getScheduleForGuide('classic-tv', d1)).some((c) => c.id.startsWith('ajn-infowars') || c.id.startsWith('mx-')), 'not duplicated into Classic TV');
const movies = await getScheduleForGuide('movies-classics-vault', d1);
assert.equal(movies[0].id, 'classic-cinema');
const visibleMovies = movies.filter((channel) => !channel.libraryOnly);
const partitions = visibleMovies.filter((channel) => channel.id.startsWith(MOVIES_CLASSICS_PARTITION_PREFIX));
assert.equal(partitions.length, 20, 'legacy list expands into 20 stable channels');
assert.deepEqual(visibleMovies.filter((c) => !c.id.startsWith(MOVIES_CLASSICS_PARTITION_PREFIX)).map((c) => c.id).sort(), [
  'classic-cinema',
  'mx-aiviixx',
  'mx-filmography',
  'mx-jt-s-ghost',
  'mx-lars-germany-mittank',
  'mx-random-movies',
]);
for (const ch of visibleMovies.slice(1)) {
  assert.equal(ch.programs[0].startHour, 0);
  assert.ok(ch.programs.every((program, index) => index === 0 || program.archivePath !== ch.programs[index - 1].archivePath), `${ch.id} has no consecutive repeated file`);
  assert.ok(Math.abs(ch.programs.at(-1)!.endHour! - 24) < 1e-6, `${ch.id} fills the day`);
}
const sw = movies.find((c) => c.id === 'mx-star-wars')!; assert.equal(sw.name, 'STAR WARS'); assert.equal(sw.libraryOnly, true); assert.equal(sw.programs.length, 1); assert.ok(sw.programs.every((p) => /\.ia\.mp4$/.test(p.archivePath!)));
const atlas = movies.find((c) => c.id === 'mx-atlas-taggart')!; assert.equal(atlas.libraryOnly, true); assert.equal(atlas.programs.length, 1);
assert.equal(JSON.stringify(m.channels), sourceRowsBefore, 'source manifest rows for other channels are not mutated or dropped');
assert.equal(resolveMoviesClassicChannelAlias('mx-movies-classics-list'), 'mx-movies-classics-01');
console.log('PASS extra-channels:', Object.fromEntries(m.channels.map((c: any) => [c.id, c.rows.length])));
