import assert from 'node:assert/strict';
import { buildLiveRows, liveCategories, rowsForCategory, LIVE_ALL } from './src/guide/liveStrip';
const prog = (s: number, e: number, t = 'P') => ({ id: t + s, title: t, startHour: s, endHour: e, archivePath: '/a/' + t + '.mp4' }) as any;
const ch = (id: string, name: string, group: string | undefined, programs: any[], mediaType = 'video') => ({ id, name, group, mediaType, programs }) as any;
const guides = [
  { guideId: 'cable-tv', channels: [ch('1', 'Zed News', 'News', [prog(10, 12)]), ch('2', 'Alpha News', 'News', [prog(0, 6)]), ch('3', 'Movies', 'Movies', [prog(9, 14)])] },
  { guideId: 'audio-podcasts', channels: [ch('1', 'Talk Radio', undefined, [prog(10, 11)], 'audio')] },
];
const rows = buildLiveRows(guides, 10.5, Date.UTC(2026, 9, 13, 18));
assert.equal(rows.length, 4);
assert.equal(new Set(rows.map((r) => r.key)).size, 4, 'same channel id in two guides does not collide');
const cats = liveCategories(rows);
assert.deepEqual(cats.map((c) => [c.label, c.count, c.onAir]), [['News', 2, 1], ['Audio', 1, 1], ['Movies', 1, 1]]);
const news = rowsForCategory(rows, 'news', 8);
assert.equal(news.total, 2);
assert.deepEqual(news.shown.map((r) => r.channel.name), ['Zed News', 'Alpha News'], 'on-air first, off-air after');
assert.equal(news.shown[1].onAir, false);
assert.equal(rowsForCategory(rows, LIVE_ALL, 2).shown.length, 2);
assert.equal(rowsForCategory(rows, LIVE_ALL, 2).total, 4);
assert.equal(rowsForCategory(rows, 'nope', 8).total, 0);
assert.deepEqual(liveCategories([]), []);
console.log('[live-strip] PASS');
