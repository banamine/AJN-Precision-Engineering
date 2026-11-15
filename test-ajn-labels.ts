import assert from 'node:assert/strict';
import { labelAjnItem } from './src/utils/ajnLabels';

const a = labelAjnItem({ title: 'VIDEO - 20261009_Fri_WarRoom-Hr1' })!;
assert.deepEqual(a, { show: 'War Room', detail: 'Hour 1', dateISO: '2026-10-09', dateLabel: 'Fri Oct 9', key: '20261009|warroom|hr1', groupKey: '20261009|warroom' });
assert.equal(labelAjnItem({ title: 'AUDIO - 20260930_Wed_WarRoom-Hr3' })!.dateLabel, 'Wed Sep 30');
assert.equal(labelAjnItem({ title: 'VIDEO - 20261010_Sat_Alex-Special' })!.detail, 'Special');
assert.equal(labelAjnItem({ title: 'VIDEO - 20261010_Sat_Alex-Special' })!.key, '20261010|alex|special');
assert.equal(labelAjnItem({ title: 'VIDEO - 20261009_Fri_Alex-Hr4' })!.show, 'Alex Jones');
// full show: title form and url form agree and share the group key with the hourly items
const full = labelAjnItem({ title: 'Alex Jones 2026-Oct-09 Friday' })!;
assert.equal(full.detail, 'Full show'); assert.equal(full.key, '20261009|alex|full'); assert.equal(full.dateLabel, 'Fri Oct 9');
assert.equal(labelAjnItem({ title: 'weird', url: 'https://archive.alexjoneslive.com/rss/20261009_Fri_Alex.mp3' })!.key, '20261009|alex|full');
assert.equal(labelAjnItem({ title: 'x', url: 'https://archive.alexjoneslive.com/hourly-mp3/20261009_Fri_Alex-Hr3.mp3?x=1' })!.groupKey, full.groupKey);
assert.equal(labelAjnItem({ title: 'Sunday Night Live 2026-Oct-04 Sunday' })!.dateLabel, 'Sun Oct 4');
assert.equal(labelAjnItem({ title: 'War Room 2026-Oct-09 Friday' })!.show, 'War Room');
// weekday comes from the date, not from the text
assert.equal(labelAjnItem({ title: 'VIDEO - 20261009_Mon_WarRoom-Hr1' })!.dateLabel, 'Fri Oct 9');
// never guess
assert.equal(labelAjnItem({ title: 'NASA Apollo 11' }), null);
assert.equal(labelAjnItem({ title: 'VIDEO - 20261340_Fri_WarRoom-Hr1' }), null);
assert.equal(labelAjnItem({ title: 'VIDEO - 20260230_Fri_WarRoom-Hr1' }), null);
assert.equal(labelAjnItem({ title: 'Alex Jones 2026-Foo-09' }), null);
assert.equal(labelAjnItem({}), null);
console.log('test-ajn-labels: all passed');
