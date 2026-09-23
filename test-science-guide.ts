// Regression: Science Documentaries exposes the NOVA canonical programs.
import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry.ts';
const channels = await getScheduleForGuide('science-documentaries');
assert.equal(channels.length, 1);
assert.equal(channels[0].id, 'nova-wonders');
assert.equal(new Set(channels[0].programs.map((p) => p.assetId)).size, 6);
assert.ok(channels[0].programs.every((p) => p.mediaUrl?.startsWith('/api/archive/proxy?path=')));
console.log('science documentaries guide regression: all passed');
{
  const p = channels[0].programs;
  assert.ok(p.length >= 24, 'NOVA repeats to fill the day');
  assert.equal(p[0].startTimeUtc!.slice(11), '00:00:00.000Z');
  assert.equal(Date.parse(p[0].endTimeUtc!) - Date.parse(p[0].startTimeUtc!), 55 * 60_000);
  assert.equal(p[1].startTimeUtc, p[0].endTimeUtc, 'back-to-back');
  assert.equal(p.at(-1)!.endTimeUtc!.slice(11), '00:00:00.000Z');
  assert.equal(new Set(p.map((x) => x.id)).size, p.length);
  const movies = (await getScheduleForGuide('movies-classics-vault'))[0].programs;
  assert.ok(movies.length > 1 && movies.every((m) => Date.parse(m.endTimeUtc!) > Date.parse(m.startTimeUtc!)), 'movies have real slots');
  console.log('daily layout: passed');
}
