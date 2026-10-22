import assert from 'node:assert/strict';
import { queryLiveRadioStations, validateLiveRadioStations } from './server/liveRadio.ts';
import ch from './server/data/liveRadioClassicHits109.json' with { type: 'json' };
const all = queryLiveRadioStations({ genre: 'Classic Hits', pageSize: 100 });
const fam = all.items.filter((s) => /classichits109\.com/.test(s.streamUrl));
assert.equal(fam.length, 9, 'all nine CH109 streams carry the Classic Hits genre');
assert.equal(new Set(fam.map((s) => s.streamUrl)).size, 9, 'no duplicate streams');
assert.equal(new Set(fam.map((s) => s.id)).size, 9);
for (const slug of ['70s', '70s-90s', 'country', 'cr109', 'softrock', 'warm109', 'summerhits', 'onehitwonders', 'christmas']) assert.ok(fam.some((s) => s.streamUrl === `https://broadcast.classichits109.com/${slug}`), slug);
const main = fam.find((s) => s.streamUrl.endsWith('/70s-90s'))!;
assert.ok(main.genres.includes('Disco') && main.genres.includes('Classic Hits'), 'stays under Disco AND Classic Hits');
assert.ok(queryLiveRadioStations({ genre: 'Disco', pageSize: 100 }).items.some((s) => s.id === main.id), 'still listed under Disco');
assert.ok(all.genres.includes('Classic Hits'), 'chip exists');
const xmas = queryLiveRadioStations({ genre: 'Christmas', pageSize: 100 }).items; assert.ok(xmas.some((s) => s.streamUrl.endsWith('/christmas')));
assert.ok(fam.every((s) => !s.logo || s.logo.startsWith('https://')), 'no logo is fine');
assert.ok(queryLiveRadioStations({ q: 'classic hits 109', pageSize: 100 }).items.length >= 9, 'brand search finds the family');
// every new record passes validation on its own, nothing rejected
const v = validateLiveRadioStations(ch.stations); assert.equal(v.rejected.length, 0, JSON.stringify(v.rejected)); assert.equal(v.valid.length, 6);
console.log('PASS classic-hits-109', fam.map((s) => s.name).join(' | '));
