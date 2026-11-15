import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildToday, formatHour, kindOf, thumbnailOf } from './src/guide/todayList';
import { TodayView } from './src/components/TodayView';
import type { ScheduleChannel, Program } from './src/types';

const prog = (id: string, s: number, e: number, extra: Partial<Program> = {}): Program => ({
  id, guideId: 'cable-tv', channelId: 'c1', title: id, startTime: s, endTime: e, startHour: s, endHour: e,
  mediaType: 'video', mediaUrl: `/api/archive/proxy?path=${id}.mp4`, ...extra,
});
const ch: ScheduleChannel = { id: 'c1', guideId: 'cable-tv', name: 'Test', mediaType: 'video', programs: [
  prog('early', 1, 2), prog('now', 9, 11, { metadata: { thumbnailUrl: 'https://archive.org/services/img/x' } }), prog('later', 12, 13),
  prog('live', 14, 15, { sourceClass: 'm3u_live' }), prog('outside', 25, 26), prog('bad', 5, 5),
  prog('song', 16, 17, { mediaType: 'audio' }),
] };

const [t] = buildToday([ch], 10);
assert.equal(t.now?.program.id, 'now');
assert.deepEqual(t.earlier.map((e) => e.program.id), ['early']);
assert.deepEqual(t.upcoming.map((e) => e.program.id), ['later', 'live', 'song']); // outside/empty dropped, sorted
assert.equal(kindOf(ch.programs[0], ch), 'replay');   // archive recording is never labelled live
assert.equal(kindOf(ch.programs[3], ch), 'live');
assert.equal(kindOf(ch.programs[6], ch), 'audio');
assert.equal(formatHour(0), '12:00 AM'); assert.equal(formatHour(13.5), '1:30 PM'); assert.equal(formatHour(24), '12:00 AM');
assert.equal(thumbnailOf(ch.programs[1]), 'https://archive.org/services/img/x');
assert.equal(thumbnailOf({ ...ch.programs[1], metadata: { thumbnailUrl: 'http://insecure/x.png' } }), undefined);
assert.equal(buildToday([{ ...ch, programs: [] }], 10)[0].now, null);

// First render (no data yet) is an honest loading state, not a blank page.
const html = renderToStaticMarkup(createElement(TodayView, { onSelectProgram: () => {}, onNavigate: () => {} }));
assert.match(html, /Today(?:'|&#x27;)s Programs/);
assert.match(html, /Loading today(?:'|&#x27;)s programmes/);
assert.match(html, /12:00 AM to 11:59 PM/);
console.log('today view: all passed');
