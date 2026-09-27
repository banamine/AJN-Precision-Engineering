// Offline regression: Rush On-This-Day selection and Old-Time Radio date preference.
import assert from 'node:assert/strict';
process.env.RUSH_CACHE_FILE = '/tmp/ajn-test-audio-cache.json';
const { dayDistance, pickRushEpisodes, buildOtrChannel } = await import('./server/audioChannels.ts');
const { setRushFetchForTests } = await import('./server/rush.ts');

const today = new Date('2026-09-26T12:00:00Z');
assert.equal(dayDistance('2005-09-26', today), 0);
assert.equal(dayDistance('1940-09-24', today), 2);
assert.equal(dayDistance('1938-01-01', new Date('2026-12-31T00:00:00Z')), 1, 'wraps the year');
assert.equal(dayDistance('1938', today), Infinity);

const idx = [
  { id: 'r-2005-09-26', date: '2005-09-26', year: 2005 },
  { id: 'r-2010-09-27', date: '2010-09-27', year: 2010 },
  { id: 'r-2012-03-01', date: '2012-03-01', year: 2012 },
  { id: 'r-2016-09-26', date: '2016-09-26', year: 2016 },
];
assert.deepEqual(pickRushEpisodes(idx, today, 3).map((e) => e.id), ['r-2005-09-26', 'r-2010-09-27', 'r-2016-09-26'], 'same day first, nearest fill, played in date order');

// OTR: the item dated nearest today is always included; every program is audio via /download.
setRushFetchForTests((async (u: string) => new Response(JSON.stringify({ files: [
  { name: `${u.split('/').pop()}_ep1.mp3`, source: 'original', length: '1800' },
  { name: `${u.split('/').pop()}_ep2.mp3`, source: 'original', length: '1750' },
] }), { status: 200 })) as typeof fetch);
const search = (async () => new Response(JSON.stringify({ response: { docs: [
  { identifier: 'OTR_Far', date: '1940-03-01' },
  { identifier: 'OTR_Near', date: '1938-09-25' },
  ...Array.from({ length: 20 }, (_, i) => ({ identifier: `OTR_Undated_${i}` })),
] } }), { status: 200 })) as typeof fetch;
const progs = await buildOtrChannel('audio-podcasts', today, search, () => 0.5);
assert.ok(progs.some((p) => p.description === 'OTR_Near'), 'nearest-dated show included');
assert.ok(progs.every((p) => p.mediaType === 'audio' && p.archivePath!.startsWith('/download/')));
assert.ok(progs.every((p) => p.channelId === 'old-time-radio'));
console.log('audio channels regression: all passed');
process.exit(0);
