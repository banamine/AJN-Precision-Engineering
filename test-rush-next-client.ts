// Offline regression: Rush role ordering, prelude handoff, and viewer-local marker.
import assert from 'node:assert/strict';
import { resolveRushNext, upNextLabel } from './src/utils/rushNext.ts';
import {
  parseRushSettings, loadRushSettings, saveRushSettings, RUSH_SETTINGS_KEY,
  hasSeenRushPreludeToday, markRushPreludeSeenToday, rushPreludeSeenKey,
} from './src/utils/rushSettings.ts';

const t = (name: string) => ({ archivePath: `/download/x/${name}.mp3` });
const day = (date: string, n: number) => ({
  date,
  episodes: [
    { id: `rush-limbaugh-radio-show-morning-update-${date}`, date, role: 'morning-update', kind: 'video', tracks: [t('wrong-prelude-as-hour')] },
    { id: `rush-limbaugh-radio-show-${date}`, date, role: 'full-show', kind: 'audio', tracks: Array.from({ length: n }, (_, i) => t(`h${i + 1}`)) },
  ],
});
let calls: string[] = [];
const net = (routes: Record<string, () => Response>) => (async (u: string) => { calls.push(u); const r = routes[u]; if (!r) throw new TypeError('Failed to fetch'); return r(); }) as any;
const json = (d: unknown, status = 200) => () => new Response(JSON.stringify(d), { status });

// Hour 1 -> Hour 2, role lookup ignores the earlier video prelude.
calls = [];
let n = await resolveRushNext('rush-vod-2005-06-03-h1', true, net({ '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)) }));
assert.equal(n.kind, 'next'); assert.equal((n as any).item.programId, 'rush-vod-2005-06-03-h2');
assert.deepEqual(calls, ['/api/rush/episode/2005-06-03']);
assert.equal(upNextLabel(n, '2005-06-03'), 'Up next: Hour 2');

// Hour 2 -> Hour 3.
n = await resolveRushNext('rush-vod-2005-06-03-h2', true, net({ '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)) }));
assert.equal(n.kind, 'next');
assert.equal((n as any).item.programId, 'rush-vod-2005-06-03-h3');

// A playing prelude hands off to Hour 1 on the same date.
calls = [];
n = await resolveRushNext('rush-vod-2005-06-03-morning-update', true, net({ '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)) }));
assert.equal(n.kind, 'next');
assert.equal((n as any).item.programId, 'rush-vod-2005-06-03-h1');
assert.equal((n as any).item.archivePath, '/download/x/h1.mp3');
assert.deepEqual(calls, ['/api/rush/episode/2005-06-03'], 'prelude never looks up another date');

// Unavailable prelude remains unavailable, but the same date's Full Show still starts.
const unavailablePreludeDay = {
  date: '2014-07-04',
  episodes: [
    { role: 'morning-update', kind: 'video', unavailable: { reason: 'not verified' } },
    { role: 'full-show', kind: 'audio', tracks: [t('h1')] },
  ],
};
calls = [];
n = await resolveRushNext('rush-vod-2014-07-04-morning-update', true, net({
  '/api/rush/episode/2014-07-04': json(unavailablePreludeDay),
  '/api/rush/next/2014-07-04': json({ nextDate: '2014-07-07', episodes: day('2014-07-07', 3).episodes }),
}));
assert.equal((n as any).item.programId, 'rush-vod-2014-07-04-h1');
assert.deepEqual(calls, ['/api/rush/episode/2014-07-04'], 'unavailable prelude does not substitute another date');

// No Full Show on the selected date means no cross-date jump from its prelude.
calls = [];
n = await resolveRushNext('rush-vod-2014-07-04-morning-update', true, net({
  '/api/rush/episode/2014-07-04': json({ date: '2014-07-04', episodes: [unavailablePreludeDay.episodes[0]] }),
  '/api/rush/next/2014-07-04': json({ nextDate: '2014-07-07', episodes: day('2014-07-07', 3).episodes }),
}));
assert.equal(n.kind, 'end_of_day');
assert.deepEqual(calls, ['/api/rush/episode/2014-07-04']);

// Last hour, continuation ON -> next available date, Hour 1.
n = await resolveRushNext('rush-vod-2005-06-03-h3', true, net({
  '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)),
  '/api/rush/next/2005-06-03': json({ currentDate: '2005-06-03', nextDate: '2005-06-06', episodes: day('2005-06-06', 3).episodes }),
}));
assert.equal((n as any).item.programId, 'rush-vod-2005-06-06-h1');
assert.equal((n as any).item.archivePath, '/download/x/h1.mp3');
assert.equal(upNextLabel(n, '2005-06-03'), 'Up next: June 6, 2005 — Hour 1');

// Last hour, continuation OFF -> end of day, no next-date request.
calls = [];
n = await resolveRushNext('rush-vod-2005-06-03-h3', false, net({ '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)) }));
assert.equal(n.kind, 'end_of_day'); assert.equal(calls.length, 1);

// End of the archive.
n = await resolveRushNext('rush-vod-2017-12-29-h3', true, net({
  '/api/rush/episode/2017-12-29': json(day('2017-12-29', 3)), '/api/rush/next/2017-12-29': json({ nextDate: null }) }));
assert.equal(n.kind, 'end_of_archive');

// 503 twice -> failed/http 503 with real timing; 404 is not retried.
calls = [];
n = await resolveRushNext('rush-vod-2005-06-03-h1', true, net({ '/api/rush/episode/2005-06-03': json({}, 503) }));
assert.equal(n.kind, 'failed'); assert.equal((n as any).failureReason, 'http'); assert.equal((n as any).httpStatus, 503);
assert.equal(calls.length, 2); assert.ok((n as any).lookupDurationMs >= 1900, 'duration includes the 2 s retry wait');
calls = [];
n = await resolveRushNext('rush-vod-2005-06-03-h1', true, net({ '/api/rush/episode/2005-06-03': json({}, 404) }));
assert.equal((n as any).httpStatus, 404); assert.equal(calls.length, 1);

// Stale during the retry wait: stop without a second request.
calls = [];
n = await resolveRushNext('rush-vod-2005-06-03-h1', true, net({}), () => true);
assert.equal(calls.length, 1); assert.equal((n as any).failureReason, 'offline');

// Preference: default ON, versioned, corrupt/unknown -> default, storage failures tolerated.
assert.equal(parseRushSettings(null).continueAcrossDates, true);
assert.equal(parseRushSettings('{bad').continueAcrossDates, true);
assert.equal(parseRushSettings('{"version":2,"continueAcrossDates":false}').continueAcrossDates, true);
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
assert.equal(saveRushSettings({ continueAcrossDates: false }, store), true);
assert.deepEqual(JSON.parse(mem.get(RUSH_SETTINGS_KEY)!), { version: 1, continueAcrossDates: false });
assert.equal(loadRushSettings(store).continueAcrossDates, false);
assert.equal(saveRushSettings({ continueAcrossDates: true }, { setItem: () => { throw new Error('QuotaExceeded'); } }), false);
assert.equal(loadRushSettings({ getItem: () => { throw new Error('SecurityError'); } }).continueAcrossDates, true);

const markerNow = new Date(2026, 9, 27, 12, 0, 0);
assert.equal(rushPreludeSeenKey(markerNow), 'ajn-rush-prelude-seen-2026-10-27');
const markerStore = new Map<string, string>();
const markerStorage = {
  getItem: (key: string) => markerStore.get(key) ?? null,
  setItem: (key: string, value: string) => { markerStore.set(key, value); },
};
assert.equal(hasSeenRushPreludeToday(markerStorage, markerNow), false, 'selecting/loading does not mark the prelude');
assert.equal(markRushPreludeSeenToday(markerStorage, markerNow), true, 'native playing callback can record the marker');
assert.equal(hasSeenRushPreludeToday(markerStorage, markerNow), true);
assert.equal(markRushPreludeSeenToday({ setItem: () => { throw new Error('QuotaExceeded'); } }, markerNow), false);
assert.equal(hasSeenRushPreludeToday({ getItem: () => { throw new Error('SecurityError'); } }, markerNow), false);
console.log('rush next (client) regression: all passed');
