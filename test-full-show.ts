import assert from 'node:assert/strict';
import { buildRadioCatalog, type RadioFeedItem } from './src/utils/ajnRadioCatalog.ts';
import { groupShowDays, planFullShow, dayKindOf } from './src/utils/ajnShowGroups.ts';
import { startShowQueue, stepShowQueue, getShowQueue, syncShowQueue, isQueuePart, peekNextPart, clearShowQueue } from './src/utils/showQueue.ts';

const H = 'https://archive.alexjoneslive.com';
let n = 0;
const item = (url: string, mediaType: 'audio' | 'video', title = ''): RadioFeedItem => ({ id: `i${n++}`, title, url, mediaType });
const day = (date: string, dow: string, show: string, hours: number[], opts: { full?: boolean; noVideo?: number[] } = {}) => [
  ...(opts.full === false ? [] : [item(`${H}/rss/${date}_${dow}_${show}.mp3`, 'audio')]),
  ...hours.flatMap((h) => [item(`${H}/hourly-mp3/${date}_${dow}_${show}-Hr${h}.mp3`, 'audio'), ...(opts.noVideo?.includes(h) ? [] : [item(`${H}/hourly-m4v/${date}_${dow}_${show}-Hr${h}.m4v`, 'video')])]),
];
const feed: RadioFeedItem[] = [
  ...day('20261009', 'Fri', 'Alex', [1, 2, 3, 4]),
  ...day('20261009', 'Fri', 'WarRoom', [1, 2, 3], { noVideo: [2] }),   // hour 2 has no video
  ...day('20261004', 'Sun', 'Alex', [1, 2]),
  ...day('20261004', 'Sun', 'SundayLive', [1, 2]),
  item(`${H}/rss/20261003_Sat_Alex-Special.mp3`, 'audio'),
  item(`${H}/hourly-m4v/20261003_Sat_Alex-Special.m4v`, 'video'),
];
const cat = buildRadioCatalog(feed);
const days = groupShowDays([...cat.radio, ...cat.exclusive]);
const by = (k: string) => days.find((d) => d.key === k)!;

// grouping: counts come from the files, not from a constant
assert.equal(by('2026-10-09|alex-jones').parts.length, 4);
assert.equal(by('2026-10-09|war-room').parts.length, 3);
assert.equal(by('2026-10-04|sunday-night-live').parts.length, 2);
assert.equal(days[0].airDate, '2026-10-09'); // newest first

// day kinds: Saturday = special broadcast, Sunday = regular line-up
assert.equal(dayKindOf('2026-10-03', false), 'special');
assert.equal(dayKindOf('2026-10-04', false), 'sunday-lineup');
assert.equal(dayKindOf('2026-10-09', false), 'weekday');
assert.equal(by('2026-10-03|alex-jones').dayKind, 'special');
assert.equal(by('2026-10-04|alex-jones').dayKind, 'sunday-lineup');

// video full show: ordered hours, all four m4v parts
const av = planFullShow(by('2026-10-09|alex-jones'), 'video');
assert.deepEqual(av.items.map((i) => i.partNo), [1, 2, 3, 4]);
assert.ok(av.items.every((i) => i.src.endsWith('.m4v') && i.programId.endsWith(':video') && i.totalParts === 4));
assert.deepEqual(av.items.map((i) => /Hour (\d) of 4/.exec(i.title)![1]), ['1', '2', '3', '4']);
assert.deepEqual(av.missingHours, []);

// War Room has 3 hours; hour 2 has no video: reported, never presented as complete
const wv = planFullShow(by('2026-10-09|war-room'), 'video');
assert.deepEqual(wv.items.map((i) => i.title.match(/Hour (\d) of (\d)/)!.slice(1).join('/')), ['1/3', '3/3']);
assert.deepEqual(wv.missingHours, [2]);
assert.equal(wv.playable, true);

// audio: one continuous whole-show file when it exists
const aa = planFullShow(by('2026-10-09|alex-jones'), 'audio');
assert.equal(aa.singleFile, true); assert.equal(aa.items.length, 1); assert.ok(aa.items[0].src.endsWith('Alex.mp3'));
// audio without a whole-show file chains the hours
const noFull = buildRadioCatalog(day('20261008', 'Thu', 'Alex', [1, 2, 3, 4], { full: false }));
const nf = planFullShow(groupShowDays([...noFull.radio])[0], 'audio');
assert.equal(nf.singleFile, false); assert.equal(nf.items.length, 4);

// special: single file, audio and video
const sp = by('2026-10-03|alex-jones');
assert.equal(planFullShow(sp, 'video').items.length, 1);
assert.equal(planFullShow(sp, 'audio').singleFile, true);

// no video at all: not playable, with a reason (no silent empty plan)
const aud = buildRadioCatalog(day('20261007', 'Wed', 'Alex', [1, 2], { noVideo: [1, 2] }));
const nv = planFullShow(groupShowDays([...aud.radio])[0], 'video');
assert.equal(nv.playable, false); assert.match(nv.reason!, /No video/);

// queue: walks the parts in order, reports a failed part, ends cleanly, ignores foreign programs
const first = startShowQueue(av, 'Alex Jones')!;
assert.equal(first.partNo, 1); assert.ok(isQueuePart(first.programId));
assert.equal(peekNextPart()!.partNo, 2);
assert.equal(stepShowQueue(1)!.partNo, 2);
assert.equal(stepShowQueue(1, true)!.partNo, 3);          // part 2 failed to play -> recorded, moves on to 3
assert.deepEqual(getShowQueue()!.failed, [2]);
assert.equal(stepShowQueue(-1)!.partNo, 2);
assert.equal(stepShowQueue(1)!.partNo, 3); assert.equal(stepShowQueue(1)!.partNo, 4);
assert.equal(stepShowQueue(1), null);                     // end of show
syncShowQueue('some-other-program');                      // picking something else ends the Full Show
assert.equal(getShowQueue(), null);
assert.equal(startShowQueue(nv, 'x'), null);              // unplayable plan never starts
clearShowQueue();
console.log('full show: all passed');
