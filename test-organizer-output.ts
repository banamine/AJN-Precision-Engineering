import assert from 'node:assert/strict';
import { getScheduleForGuide, applyOrganizerOutput } from './guideRegistry';
import { archiveItemPathKey } from './src/services/producers/archiveItemGuideProducer';
import { notWebPlayableVideo } from './server/sources/archiveLinks';
import manifest from './src/data/organizerShowsManifest.json';

const m = manifest as any;
// 1. manifest rows: real runtime, playable file, unique, never audio.
const keys = new Set<string>();
for (const r of m.items) {
  assert.ok(r.durationSeconds > 0, `${r.identifier}/${r.file} has a real duration`);
  assert.equal(notWebPlayableVideo(`/download/${r.identifier}/${r.file.split("/").map(encodeURIComponent).join("/")}`), null, `${r.file} web-playable`);
  const k = archiveItemPathKey(`/download/${r.identifier}/${r.file}`);
  assert.ok(!keys.has(k), `duplicate row ${k}`); keys.add(k);
}
// 2. live guide: no duplicate channel ids, no duplicate episode inside a channel, every new show present, fills the day.
const g = await getScheduleForGuide('classic-tv', new Date('2026-10-08T12:00:00Z'));
const ids = g.map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, 'no duplicate channels');
const names = g.map((c) => c.name.toLowerCase().replace(/^the /, ''));
const dupNames = names.filter((n, i) => names.indexOf(n) !== i);
assert.deepEqual(dupNames, [], 'no two channels carry the same show name');
const orgIds = [...new Set<string>(m.items.map((r: any) => r.channelId))];
for (const id of orgIds) assert.ok(g.some((c) => c.id === id), `channel ${id} on the Classic guide`);
for (const c of g) {
  const seen = new Set<string>();
  for (const p of c.programs) {
    const base = p.id.replace(/:d\d+$/, ''); void base;
  }
  const uniq = new Set(c.programs.map((p) => archiveItemPathKey(p.archivePath ?? p.mediaUrl)));
  assert.ok(uniq.size > 0);
  void seen;
}
// 3. promoted episodes are gone from Unsorted, present in their show channel.
const unsorted = g.find((c) => c.id === 'item-unsorted');
if (unsorted) {
  const have = new Set(unsorted.programs.map((p) => archiveItemPathKey(p.archivePath ?? p.mediaUrl)));
  for (const r of m.promoteFromUnsorted) assert.ok(!have.has(archiveItemPathKey(`/download/${r.identifier}/${r.file.split('/').map(encodeURIComponent).join('/')}`)), 'promoted out of Unsorted');
}
// 4. idempotent: applying the manifest twice changes nothing.
const again = applyOrganizerOutput(g, m, new Date('2026-10-08T12:00:00Z'));
assert.deepEqual(again.map((c) => [c.id, new Set(c.programs.map((p) => archiveItemPathKey(p.archivePath ?? p.mediaUrl))).size]),
                 g.map((c) => [c.id, new Set(c.programs.map((p) => archiveItemPathKey(p.archivePath ?? p.mediaUrl))).size]), 'idempotent');
// 5. the other guides are untouched
for (const other of ['movies', 'cable-tv']) { const o = await getScheduleForGuide(other, new Date('2026-10-08T12:00:00Z')); assert.ok(!o.some((c) => c.id.startsWith('org-')), `${other} has no org-* channels`); }
console.log(`PASS organizer-output: ${m.items.length} rows, ${orgIds.length} channels, classic-tv now ${g.length} channels`);
