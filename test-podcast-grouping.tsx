import assert from 'node:assert/strict';
const { buildSpokenItems } = await import('./src/utils/listenCatalog');
const ep = (id: string, title: string, aired: string) => ({ id, title, mediaUrl: `https://x/${id}.mp3`, metadata: { airedUtc: aired, podcast: true } });
const channels = [
  { id: 'fox', name: 'Fox News Radio', group: 'Podcast', programs: [
    ep('f3', 'Third edition', '2026-11-10T18:00:00Z'),
    ep('f1', 'First edition', '2026-11-10T08:00:00Z'),
    ep('f2', 'Second edition', '2026-11-10T13:00:00Z'),
    ep('fy', 'Yesterday edition', '2026-11-09T08:00:00Z'),
  ]},
  { id: 'otr', name: 'Old Radio Hour', group: 'Old-Time Radio', programs: [
    { id: 'o1', title: 'Ep 1', mediaUrl: 'https://x/o1.mp3' },
    { id: 'o2', title: 'Ep 2', mediaUrl: 'https://x/o2.mp3' },
  ]},
  { id: 'dup', name: 'Repeat Show', group: 'Podcast', programs: [
    ep('d1', 'Morning', '2026-11-10T09:00:00Z'),
    { id: 'd1b', title: 'Morning (repeat)', mediaUrl: 'https://x/d1.mp3', metadata: { airedUtc: '2026-11-10T15:00:00Z', podcast: true } },
  ]},
];
const { items } = buildSpokenItems(channels as never);
const fox = items.find((i: any) => i.channelId === 'fox');
assert.ok(fox, 'Fox News Radio has one box');
assert.equal(items.filter((i: any) => i.channelId === 'fox').length, 1, 'one box per programme, not one per episode');
const t = fox.tracks();
assert.equal(t.length, 3, "only the latest day's editions");
assert.deepEqual(t.map((x: any) => x.title), ['First edition', 'Second edition', 'Third edition'], 'oldest first');
assert.deepEqual(t.map((x: any) => x.partNo), [1, 2, 3]);
assert.equal(t[0].totalParts, 3);
assert.equal(fox.subtitle, '3 editions');
assert.equal(fox.trackCount, 3);
const dup = items.find((i: any) => i.channelId === 'dup');
assert.equal(dup.tracks().length, 1, 'a repeat airing of the same file is not queued twice');
assert.equal(items.filter((i: any) => i.channelId === 'otr').length, 2, 'Old-Time Radio stays one box per episode');
console.log('podcast grouping: all checks passed');
