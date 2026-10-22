import assert from 'node:assert/strict';
import { RADIO_GROUPS, RADIO_GROUP_KEY, loadGroupSelection, saveGroupSelection, stepIndex } from './src/utils/radioGroups.ts';
import { queryLiveRadioStations } from './server/liveRadio.ts';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

// Every member id exists in the live-radio directory (one request by ids returns all of them), in a unique stream each.
const g = RADIO_GROUPS[0];
const page = queryLiveRadioStations({ ids: g.members.map((m) => m.id).join(','), pageSize: 50 });
assert.equal(page.items.length, g.members.length, `directory lists all ${g.members.length} group stations`);
assert.equal(new Set(page.items.map((s) => s.streamUrl)).size, g.members.length, 'no duplicate stream URLs');
assert.ok(page.items.every((s) => /classichits109\.com/.test(s.streamUrl)));
assert.equal(new Set(g.members.map((m) => m.id)).size, g.members.length);

// Wrap-around stepping, including "nothing selected yet".
assert.equal(stepIndex(-1, 9, 1), 0); assert.equal(stepIndex(-1, 9, -1), 8);
assert.equal(stepIndex(8, 9, 1), 0); assert.equal(stepIndex(0, 9, -1), 8); assert.equal(stepIndex(3, 9, 1), 4);
assert.equal(stepIndex(0, 0, 1), -1);

// Persistence: remembered, survives bad data, ignores unknown ids.
const s = mem();
assert.deepEqual(loadGroupSelection(RADIO_GROUPS, s), { groupId: 'ch109', stationId: null });
saveGroupSelection({ groupId: 'ch109', stationId: g.members[4].id }, s);
assert.equal(loadGroupSelection(RADIO_GROUPS, s).stationId, g.members[4].id, 'selection stays until changed');
s.setItem(RADIO_GROUP_KEY, JSON.stringify({ groupId: 'ch109', stationId: 'radio:gone' }));
assert.equal(loadGroupSelection(RADIO_GROUPS, s).stationId, null);
s.setItem(RADIO_GROUP_KEY, '{bad json');
assert.equal(loadGroupSelection(RADIO_GROUPS, s).groupId, 'ch109');
console.log(`test-radio-groups: ok (${g.members.length} stations)`);
