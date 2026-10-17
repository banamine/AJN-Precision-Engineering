import assert from 'node:assert/strict';
import { getLiveRadioStatus, queryLiveRadioStations } from './server/liveRadio';
import vancouver from './server/data/liveRadioVancouver.json';

// The Vancouver additions are valid, directory-only, and reachable through the normal region/city filters.
const added = (vancouver as { stations: Array<{ id: string; name: string; streamUrl: string }> }).stations;
assert.ok(added.length >= 1, 'additions file has stations');
assert.ok(added.every((s) => s.streamUrl.startsWith('https://')), 'https only');

const status = getLiveRadioStatus();
const rejectedAdded = status.rejected.filter((r) => added.some((s) => s.id === r.id));
assert.deepEqual(rejectedAdded, [], 'no Vancouver addition is rejected by the validator');
assert.equal(status.guide, 0, 'additions are directory-only: guide stays 0');

const bc = queryLiveRadioStations({ country: 'CA', region: 'British Columbia', pageSize: 100 });
const ids = new Set(bc.items.map((s) => s.id));
for (const s of added) assert.ok(ids.has(s.id), `listed under British Columbia: ${s.name}`);
assert.ok(bc.cities.includes('Vancouver'), 'Vancouver is a city filter option');

const van = queryLiveRadioStations({ country: 'CA', region: 'British Columbia', city: 'Vancouver', pageSize: 100 });
assert.ok(van.items.every((s) => s.city === 'Vancouver'));
const addedIds = new Set(added.map((s) => s.id));
assert.ok(van.items.filter((s) => addedIds.has(s.id)).every((s) => s.timeZone === 'America/Vancouver'), 'added Vancouver stations carry America/Vancouver');
assert.ok(van.total >= added.filter((s) => s.name !== 'Pulse FM 107.7').length);
assert.ok(new Set(van.items.map((s) => s.id)).size === van.items.length, 'no duplicate ids');
assert.ok(new Set(van.items.map((s) => s.streamUrl)).size === van.items.length, 'no duplicate stream URLs');

// Icons: https only; Pulse FM stays without one (only a 16 px icon exists); the existing JR Country gets one through logoFallbacks.
const withLogo = van.items.filter((s) => addedIds.has(s.id) && s.logo);
assert.equal(withLogo.length, added.filter((s) => (s as { logo?: string }).logo).length);
assert.ok(withLogo.every((s) => s.logo!.startsWith('https://www.google.com/s2/favicons?domain=')));
assert.equal(van.items.find((s) => s.name === 'Pulse FM 107.7')?.logo, undefined);
const jr = queryLiveRadioStations({ q: '93.7 JR Country', pageSize: 10 }).items.find((s) => s.id === 'radio:rb-e054f81c-d2ac-47ff-9f9e-e070cd24e6e3');
assert.ok(jr?.logo?.includes('domain=jrcountry.ca'), 'JR Country has an icon');

console.log(`test-live-radio-vancouver: ok (${added.length} added, ${van.total} in Vancouver)`);
