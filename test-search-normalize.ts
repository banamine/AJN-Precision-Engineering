import assert from 'node:assert/strict';
import { joinedKey, matchesQuery } from './src/search/normalize';

// joinedKey tests
assert.equal(joinedKey('M*A*S*H (1970)'), 'mash1970');
assert.equal(joinedKey('Abbott & Costello'), 'abbottandcostello');
assert.equal(joinedKey('Café'), 'cafe');

// Must match: fields ["M*A*S*H (1970)"] with queries "mash", "MASH", "m.a.s.h", "m a s h", "MASH 1970"
const mashFields = ['M*A*S*H (1970)'];
assert.equal(matchesQuery(mashFields, 'mash'), true);
assert.equal(matchesQuery(mashFields, 'MASH'), true);
assert.equal(matchesQuery(mashFields, 'm.a.s.h'), true);
assert.equal(matchesQuery(mashFields, 'm a s h'), true);
assert.equal(matchesQuery(mashFields, 'MASH 1970'), true);

// Must match: ["Abbott & Costello"] with "abbott and costello" and "abbott costello"
const abbottFields = ['Abbott & Costello'];
assert.equal(matchesQuery(abbottFields, 'abbott and costello'), true);
assert.equal(matchesQuery(abbottFields, 'abbott costello'), true);

// Must match: ["Dragnet ( 1951)"] with "dragnet 1951"
const dragnetFields = ['Dragnet ( 1951)'];
assert.equal(matchesQuery(dragnetFields, 'dragnet 1951'), true);

// Must match: ["Café Society"] with "cafe"
const cafeFields = ['Café Society'];
assert.equal(matchesQuery(cafeFields, 'cafe'), true);

// Must match: ["The Twilight Zone 1959 S01"] with "zone twilight"
const twilightFields = ['The Twilight Zone 1959 S01'];
assert.equal(matchesQuery(twilightFields, 'zone twilight'), true);

// Real title with asterisks plus a query typed with them
assert.equal(matchesQuery(['M*A*S*H (1970)', '', 'mash.-1970.1080p.-blu-ray'], 'M*A*S*H'), true);
assert.equal(matchesQuery(['M*A*S*H (1970)'], 'M*A*S*H 1970'), true);

// Must NOT match: ["Gunsmoke"] with "mash"
assert.equal(matchesQuery(['Gunsmoke'], 'mash'), false);

// Must NOT match: ["The Twilight Zone"] with "twilight xyz"
assert.equal(matchesQuery(['The Twilight Zone'], 'twilight xyz'), false);

// Also: empty query -> true
assert.equal(matchesQuery(['Gunsmoke'], ''), true);
assert.equal(matchesQuery(['Gunsmoke'], '   '), true);
assert.equal(matchesQuery([], ''), true);

// Also: "**" -> false and does not throw
assert.equal(matchesQuery(['Gunsmoke'], '**'), false);
assert.equal(matchesQuery(['M*A*S*H (1970)'], '**'), false);
assert.equal(matchesQuery([], '**'), false);

console.log('test-search-normalize: all passed');
process.exit(0);
