// Regression: the live Classic TV schedule carries the curated series channels exactly once, with Organizer episodes folded in.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { getScheduleForGuide } = await import('./guideRegistry.ts');
const g = await getScheduleForGuide('classic-tv', new Date('2026-10-08T12:00:00Z'));
const by = new Map(g.map((c: any) => [c.id, c]));
assert.equal(by.size, g.length, 'no duplicate channel ids');
const taxi: any = by.get('classic-series-taxi'); assert.ok(taxi && taxi.programs.length >= 100, 'Taxi, all seasons, is on Classic TV');
assert.equal(taxi.programs[0].title.startsWith('Taxi S01E01'), true, 'Taxi starts at S01E01');
assert.ok(by.get('classic-series-hogans-heroes'), "Hogan's Heroes present");
assert.ok(![...by.values()].some((c: any) => /hogan family/i.test(c.name)), 'Hogan Family is never merged into Hogan\'s Heroes');
assert.ok(by.get('classic-western-death-valley-days'), 'Death Valley Days present');
assert.equal(by.has('item-the-protectors'), false, 'catalog Protectors folded into the series channel');
const prot: any = by.get('classic-series-l4-the-protectors'); assert.ok(prot.programs.length > 56, 'folded episodes added');
const names = g.map((c: any) => c.name.toLowerCase().replace(/^the /, '')); assert.deepEqual(names.filter((n: string, i: number) => names.indexOf(n) !== i), [], 'no duplicate show names');
console.log('classic series live: ok', g.length, 'channels');
