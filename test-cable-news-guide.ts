// Regression: Cable TV guide is built from the Archive News contract with real air times.
import assert from 'node:assert/strict';
import { getScheduleForGuide, setCableNewsFetchForTests } from './guideRegistry.ts';

const today = new Date();
const stamp = (hoursAgo: number) => {
  const d = new Date(today.getTime() - hoursAgo * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}0000`;
};
const cnnId = `CNNW_${stamp(30)}_CNN_News_Central`;
const foxId = `FOXNEWSW_${stamp(40)}_Hannity`;

setCableNewsFetchForTests((async (input: any) => {
  const url = decodeURIComponent(String(input));
  const json = (status: number, body?: unknown) => new Response(body ? JSON.stringify(body) : '', { status });
  if (url.includes('advancedsearch')) {
    if (url.includes('collection:CNNW ')) return json(200, { response: { docs: [{ identifier: cnnId }] } });
    if (url.includes('collection:FOXNEWSW ')) return json(200, { response: { docs: [{ identifier: foxId }] } });
    if (url.includes('collection:MSNBCW ')) return json(503);
    return json(200, { response: { docs: [] } });
  }
  if (url.includes(`metadata/${cnnId}`)) return json(200, { metadata: { title: 'CNN News Central' }, files: [{ name: `${cnnId}.mp4`, source: 'derivative', length: '3600' }] });
  if (url.includes(`metadata/${foxId}`)) return json(200, { metadata: { 'access-restricted-item': 'true' } });
  return json(404);
}) as typeof fetch);

const channels = await getScheduleForGuide('cable-tv');
const by = Object.fromEntries(channels.map((c) => [c.id, c]));
assert.deepEqual(channels.map((c) => c.id), ['fox-news', 'cnn', 'msnbc', 'bbc', 'ntd']);

const cnn = by['cnn'];
assert.equal(cnn.sourceStatus, 'ok');
assert.equal(cnn.programs.length, 1);
const prog = cnn.programs[0];
assert.equal(prog.title, 'CNN News Central');
const aired = Date.parse(prog.startTimeUtc!);
assert.ok(Math.abs(aired - (today.getTime() - 30 * 3600_000)) < 3600_000, 'real air time, not "now minus one hour"');
assert.equal(Date.parse(prog.endTimeUtc!) - aired, 3600_000);
assert.equal(cnn.logo, 'https://archive.org/services/img/CNNW');

assert.equal(by['fox-news'].sourceStatus, 'restricted');
assert.equal(by['fox-news'].rejected?.[0].reason, 'restricted: access-restricted item');
assert.equal(by['msnbc'].sourceStatus, 'upstream_error');
assert.equal(by['msnbc'].sourceError, 'advancedsearch HTTP 503');
assert.equal(by['bbc'].programs.length, 0);

setCableNewsFetchForTests(undefined);
console.log('cable news guide regression: all passed');
