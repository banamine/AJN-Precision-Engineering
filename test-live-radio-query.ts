import assert from 'node:assert/strict';
import { queryLiveRadioStations, liveRadioProgramId, getLiveRadioChannels } from './server/liveRadio';
const { layoutDailySchedule } = await import('./guideRegistry');

// Real list: the 4 curated test stations + the bulk directory (all directory-only). WRFL and CBC stay hidden (no verifiedAt).
const CURATED = ['CiTR 101.9 FM', 'CJAD 800', 'KEXP 90.3 FM', 'WUKY 91.3 FM'];
const all = queryLiveRadioStations({ pageSize: 100 });
const everything = queryLiveRadioStations({ pageSize: 1 });
assert.ok(everything.total >= 2000, `bulk loaded: ${everything.total}`);
assert.deepEqual(everything.countries, ['CA', 'US']);
assert.ok(everything.genres.length > 0 && everything.genres.length <= 30, 'genre chips capped at 30');
assert.ok(everything.regions.includes('Ontario') && everything.regions.includes('California'), 'regions of both countries');
for (const name of CURATED) assert.equal(queryLiveRadioStations({ q: name }).items.some((s) => s.name === name && !s.inGuide), true, `${name} is in the directory and is not a guide channel`);
assert.ok(queryLiveRadioStations({ pageSize: 100 }).items.every((s) => !s.inGuide), 'no real station is a guide channel');
assert.deepEqual(queryLiveRadioStations({ ids: 'radio:us-wrfl,radio:ca-cbc-radio-one-toronto' }).items, [], 'unverified stations are never listed');
const walk: string[] = [];
for (let p = 1; p <= Math.ceil(everything.total / 100); p += 1) for (const s of queryLiveRadioStations({ pageSize: 100, page: p }).items) walk.push(s.id);
assert.equal(new Set(walk).size, everything.total, 'paging visits every station exactly once');
const all100 = queryLiveRadioStations({ pageSize: 100, page: 1 }).items;
assert.ok(all100.every((s) => s.streamUrl.startsWith('https://') && typeof s.description === 'string'));
assert.equal(walk.filter((id) => !id.startsWith('radio:')).length, 0);
assert.equal(queryLiveRadioStations({ pageSize: 100000 }).pageSize, 100, 'pageSize capped');
assert.equal(queryLiveRadioStations({ pageSize: Number.NaN }).pageSize, 24);
assert.equal(queryLiveRadioStations({ page: -5 }).page, 1);

// Country > region > city narrowing on the real list
const ca = queryLiveRadioStations({ country: 'CA', pageSize: 100 });
assert.ok(ca.total >= 200 && ca.items.every((s) => s.country === 'CA'));
assert.ok(!ca.regions.includes('California') && ca.regions.includes('Ontario'), 'regions follow the country');
assert.deepEqual(ca.cities, [], 'no city list until a region is chosen');
const on = queryLiveRadioStations({ country: 'CA', region: 'ontario', pageSize: 100 });
assert.ok(on.total > 0 && on.items.every((s) => s.region === 'Ontario'), 'region filter is case-insensitive');
assert.ok(on.cities.length > 0 && on.cities.includes('Toronto'), 'cities of the chosen region');
const tor = queryLiveRadioStations({ country: 'CA', region: 'Ontario', city: 'toronto', pageSize: 100 });
assert.ok(tor.total > 0 && tor.items.every((s) => s.city === 'Toronto' && s.timeZone === 'America/Toronto'), 'city filter; Toronto stations carry America/Toronto');
assert.equal(queryLiveRadioStations({ country: 'US', region: 'Ontario' }).total, 0, 'a province is not a US state');
assert.ok(queryLiveRadioStations({ country: 'US', pageSize: 100 }).items.every((s) => s.country === 'US'));
assert.ok(everything.total === queryLiveRadioStations({ country: 'US' }).total + queryLiveRadioStations({ country: 'CA' }).total);
for (const s of walk.length ? queryLiveRadioStations({ pageSize: 100 }).items : []) if (s.timeZone) assert.match(s.timeZone, /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/);

// Facets stay stable while filtering
const none = queryLiveRadioStations({ q: 'zzzzzzzz' });
assert.equal(none.total, 0);
assert.deepEqual(none.genres, everything.genres);
assert.deepEqual(queryLiveRadioStations({ ids: 'radio:us-kexp,radio:ca-cjad,radio:us-wrfl' }).items.map((s) => s.id), ['radio:ca-cjad', 'radio:us-kexp'], 'favorites ids; hidden ids never appear');

// Fixture list: scale, hls kept (the page shows it disabled), disabled never listed
const fixture = Array.from({ length: 250 }, (_, i) => ({
  id: `radio:us-fx${i}`, name: `Fixture ${String(i).padStart(3, '0')}`, country: i % 2 ? 'CA' : 'US', streamUrl: `https://fixture.example/${i}.mp3`,
  streamType: i === 0 ? 'hls' : 'mp3', enabled: i !== 1, verifiedAt: '2026-10-13', genres: ['Fixture', `G${i % 3}`],
}));
const big = queryLiveRadioStations({ pageSize: 100, page: 3 }, fixture);
assert.equal(big.total, 249, 'disabled station not listed');
assert.equal(big.items.length, 49);
assert.equal(queryLiveRadioStations({ genre: 'G1' }, fixture).total, 83 - 1, 'genre filter across a big list (station 1 disabled)');
assert.equal(queryLiveRadioStations({}, fixture).items.find((s) => s.id === 'radio:us-fx0')?.streamType, 'hls');

// Region/city facets on a small fixture, and invalid time zones are rejected (not guessed)
const geo = [
  { id: 'radio:a', name: 'A', country: 'US', region: 'Texas', city: 'Austin', timeZone: 'America/Chicago' },
  { id: 'radio:b', name: 'B', country: 'US', region: 'Texas', city: 'Dallas', timeZone: 'America/Chicago' },
  { id: 'radio:c', name: 'C', country: 'CA', region: 'Alberta', city: 'Calgary', timeZone: 'America/Edmonton' },
  { id: 'radio:d', name: 'D', country: 'CA', timeZone: 'Not/A zone!' },
].map((x) => ({ streamUrl: `https://f.example/${x.id}`, streamType: 'mp3', enabled: true, verifiedAt: '2026-10-13', ...x }));
const g = queryLiveRadioStations({ region: 'Texas' }, geo);
assert.deepEqual(g.items.map((s) => s.name), ['A', 'B']);
assert.deepEqual(g.cities, ['Austin', 'Dallas']);
assert.deepEqual(g.regions, ['Alberta', 'Texas']);
assert.deepEqual(queryLiveRadioStations({ country: 'US' }, geo).regions, ['Texas']);
assert.equal(queryLiveRadioStations({ region: 'Texas', city: 'Dallas' }, geo).total, 1);
assert.equal(queryLiveRadioStations({}, geo).total, 3, 'invalid timeZone record is rejected, not shown');
assert.equal(queryLiveRadioStations({}, geo).items.find((s) => s.name === 'C')?.timeZone, 'America/Edmonton');

// The directory plays under the SAME program id the guide uses (history, favorites and the meter flag key on it)
const chans = await getLiveRadioChannels('audio-podcasts', layoutDailySchedule);
for (const c of chans) assert.equal(c.programs[0].id, liveRadioProgramId(c.id), c.id);
console.log('test-live-radio-query: ok');
