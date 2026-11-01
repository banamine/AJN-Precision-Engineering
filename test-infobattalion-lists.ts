// Guards the @infobattalion list additions (tools/build-infobattalion-lists.py): bounded payloads, no duplicate ids/names, explicit schema.
import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import extra from './src/data/extraChannelsManifest.json';
import docs from './src/data/documentariesManifest.json';
import audio from './src/data/archiveAudioChannels.json';

const BUDGET_MB: Record<string, number> = { 'classic-tv': 30, 'movies-classics-vault': 3, 'cable-tv': 4, 'science-documentaries': 6 };
for (const guide of Object.keys(BUDGET_MB)) {
  const channels = await getScheduleForGuide(guide);
  const ids = channels.map((c: any) => c.id);
  assert.equal(ids.length, new Set(ids).size, `${guide}: duplicate channel ids`);
  const mb = Buffer.byteLength(JSON.stringify(channels)) / 1048576;
  assert.ok(mb < BUDGET_MB[guide], `${guide}: ${mb.toFixed(1)} MB exceeds budget ${BUDGET_MB[guide]} MB`);
}
const classic = await getScheduleForGuide('classic-tv');
const tvx = classic.filter((c: any) => c.id.startsWith('tvx-'));
assert.ok(tvx.length >= 20, `expected the Tv Classics additions, got ${tvx.length}`);
assert.ok(tvx.every((c: any) => c.programs.length > 0 && c.programs.every((p: any) => p.mediaUrl && p.metadata?.durationSeconds > 0)));
const names = classic.map((c: any) => c.name.toLowerCase());
assert.equal(names.length, new Set(names).size, 'classic-tv: duplicate channel names');
assert.ok(classic.some((c: any) => c.id.startsWith('classic-series-taxi')), 'Taxi must stay');
const movies = await getScheduleForGuide('movies-classics-vault');
for (const id of ['mx-movies-classics-list', 'mx-filmography', 'mx-atlas-taggart']) assert.ok(movies.some((c: any) => c.id === id && c.programs.length > 0), `movies channel ${id}`);
assert.ok((await getScheduleForGuide('cable-tv')).some((c: any) => c.id === 'ajn-new-world-tyranny' && c.programs.length > 0));
assert.equal((extra as any).schema, 'ajn.extraChannelsManifest.v1');
for (const c of (extra as any).channels) for (const r of c.rows) assert.ok(r.durationSeconds >= 30 && r.identifier && r.file, `${c.id}: bad row ${r.id}`);
for (const e of docs as any[]) assert.ok(e.u && e.t && e.g, `docs: bad entry ${e.id}`);
const aids = (audio as any[]).map(a => a.id); assert.equal(aids.length, new Set(aids).size, 'audio channel ids unique');
for (const a of audio as any[]) assert.ok(a.itemId && a.name && a.group, `audio entry ${a.id}`);
console.log('infobattalion lists OK', { tvx: tvx.length, movies: movies.length, audio: aids.length });
