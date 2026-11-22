import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFillerPool, dateFromText, spread } from './onairFiller';
import type { ScheduleChannel } from '../src/types';

const prog = (n: number, start: number, end: number): any => ({ id: `p${n}`, title: `CNN ${n}`, mediaUrl: `/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4`, mediaType: 'video', metadata: { airedUtc: '2026-11-20T05:00:00Z', clip: { index: n, start, end } } });
const ch = (name: string, programs: any[]): ScheduleChannel => ({ id: name, guideId: 'cable-tv', name, mediaType: 'video', programs } as ScheduleChannel);

test('dateFromText reads 20141015 and 2014-10-15, and returns null when there is no date', () => {
  assert.equal(dateFromText('20141015 Wed NightlyNews-HD'), '2014-10-15');
  assert.equal(dateFromText('Show 2023-01-17T07:15 x'), '2023-01-17');
  assert.equal(dateFromText('INFOWARS COLLECTION HISTORY 52'), null);
});
test('spread covers the whole list', () => {
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), [1, 3, 5, 7, 9]);
  assert.deepEqual(spread([1, 2], 5), [1, 2]);
});
test('news clips: only clip windows of 60-600 s from the wanted channels; CTV and others are not used; a missing channel is reported', () => {
  const pool = buildFillerPool({
    scheduleChannels: [ch('CNN', [prog(0, 0, 300), prog(1, 300, 600), prog(2, 600, 620)]), ch('CTV News', [prog(0, 0, 300)]), ch('Some Other', [prog(0, 0, 300)])],
    manifest: { channels: [] }, quashPrograms: [], now: new Date('2026-11-22T12:00:00Z'),
  });
  assert.equal(pool.news.length, 2);
  assert.ok(pool.news.every((c) => c.channel === 'CNN' && c.durSec === 300 && c.clipDate === '2026-11-20'));
  assert.ok(pool.missing.some((m) => m.includes('"Fox News"')));
  assert.ok(pool.missing.some((m) => m.includes('INFO WARS SURVIVAL')));
  assert.ok(pool.missing.some((m) => m.includes('Quash')));
});
test('long clips come from the manifest rows with a real length, with the recording date from the title; short files are skipped', () => {
  const pool = buildFillerPool({
    scheduleChannels: [], quashPrograms: [],
    manifest: { channels: [{ id: 'ajn-new-world-tyranny', name: 'NEW WORLD TYRANNY', rows: [
      { identifier: 'item-1', file: 'dir/20141015 Wed NightlyNews-HD.mp4', title: '20141015 Wed NightlyNews-HD', durationSeconds: 2512 },
      { identifier: 'item-2', file: 'short.mp4', title: 'short', durationSeconds: 120 },
    ] }] },
  });
  assert.equal(pool.long.length, 1);
  assert.equal(pool.long[0].clipDate, '2014-10-15');
  assert.ok(pool.long[0].src.startsWith('/api/archive/proxy?path='));
});
test('quash: archive programs with a known length become Break clips', () => {
  const pool = buildFillerPool({ scheduleChannels: [], manifest: { channels: [] }, quashPrograms: [{ id: 'q', title: 'Ep', archivePath: '/download/item/Podcasts/The%20Quash/ep.mp3', metadata: { durationSeconds: 2700 } } as any, { id: 'q2', title: 'No length', archivePath: '/download/item/x.mp3', metadata: {} } as any] });
  assert.equal(pool.quash.length, 1); assert.equal(pool.quash[0].durSec, 2700);
});

test('news clips older than 7 days (or with no recording date) are never used as news; the channel is reported with its newest date', () => {
  const old = (n: number): any => ({ id: `o${n}`, title: `Fox old ${n}`, mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4', mediaType: 'video', metadata: { airedUtc: '2026-10-31T02:00:00Z', clip: { start: 0, end: 300 } } });
  const undated: any = { id: 'u', title: 'CNN undated', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4', mediaType: 'video', metadata: { clip: { start: 0, end: 300 } } };
  const fresh: any = { id: 'f', title: 'CNN fresh', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4', mediaType: 'video', metadata: { airedUtc: '2026-11-21T20:00:00Z', clip: { start: 0, end: 300 } } };
  const pool = buildFillerPool({ scheduleChannels: [ch('Fox News', [old(1), old(2)]), ch('CNN', [undated, fresh, old(3)])], manifest: { channels: [] }, quashPrograms: [], now: new Date('2026-11-22T12:00:00Z') });
  assert.deepEqual(pool.news.map((c) => c.title), ['CNN fresh']);
  assert.ok(pool.missing.some((m) => m.includes('"Fox News"') && m.includes('2026-10-31') && m.includes('7 days')));
});
test('news clips are taken newest first', () => {
  const mk = (n: number, d: string): any => ({ id: `n${n}`, title: `CNN ${n}`, mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4', mediaType: 'video', metadata: { airedUtc: `${d}T10:00:00Z`, clip: { start: 0, end: 300 } } });
  const pool = buildFillerPool({ scheduleChannels: [ch('CNN', [mk(1, '2026-11-17'), mk(2, '2026-11-21'), mk(3, '2026-11-19')])], manifest: { channels: [] }, quashPrograms: [], now: new Date('2026-11-22T12:00:00Z') });
  assert.deepEqual(pool.news.map((c) => c.clipDate), ['2026-11-21', '2026-11-19', '2026-11-17']);
});
