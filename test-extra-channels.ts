import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import { notWebPlayableVideo } from './server/sources/archiveLinks';
import manifest from './src/data/extraChannelsManifest.json';

const m = manifest as any;
assert.equal(m.schema, 'ajn.extraChannelsManifest.v1');
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
assert.deepEqual(movies.slice(1).map((c) => c.id).sort(), ['mx-aiviixx', 'mx-atlas-taggart', 'mx-filmography', 'mx-genre-action-adventure-western', 'mx-genre-british-comedy', 'mx-genre-documentaries', 'mx-genre-horror-monsters', 'mx-genre-mystery-crime', 'mx-genre-scifi-superhero', 'mx-jt-s-ghost', 'mx-lars-germany-mittank', 'mx-movies-classics-list', 'mx-random-movies', 'mx-star-wars']);
for (const ch of movies.slice(1)) { assert.equal(ch.programs[0].startHour, 0); assert.ok(Math.abs(ch.programs.at(-1)!.endHour! - 24) < 1e-6, `${ch.id} fills the day`); }
const sw = movies.find((c) => c.id === 'mx-star-wars')!; assert.equal(sw.name, 'STAR WARS'); assert.ok(sw.programs.every((p) => /\.ia\.mp4$/.test(p.archivePath!)));
console.log('PASS extra-channels:', Object.fromEntries(m.channels.map((c: any) => [c.id, c.rows.length])));
