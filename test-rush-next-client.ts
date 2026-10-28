// Offline regression: Rush "what plays next" (shared by auto-advance and Up Next) + the saved preference.
import assert from 'node:assert/strict';
import { resolveRushNext, upNextLabel } from './src/utils/rushNext.ts';
import { parseRushSettings, loadRushSettings, saveRushSettings, RUSH_SETTINGS_KEY } from './src/utils/rushSettings.ts';

const t = (n: number) => ({ archivePath: `/download/x/h${n}.mp3` });
const day = (date: string, n: number) => ({ date, episodes: [{ tracks: Array.from({ length: n }, (_, i) => t(i + 1)) }] });
let calls: string[] = [];
const net = (routes: Record<string, () => Response>) => (async (u: string) => { calls.push(u); const r = routes[u]; if (!r) throw new TypeError('Failed to fetch'); return r(); }) as any;
const json = (d: unknown, status = 200) => () => new Response(JSON.stringify(d), { status });

// Hour 1 -> Hour 2, no next-date lookup.
calls = [];
let n = await resolveRushNext('rush-vod-2005-06-03-h1', true, net({ '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)) }));
assert.equal(n.kind, 'next'); assert.equal((n as any).item.programId, 'rush-vod-2005-06-03-h2');
assert.deepEqual(calls, ['/api/rush/episode/2005-06-03']);
assert.equal(upNextLabel(n, '2005-06-03'), 'Up next: Hour 2');

// Last hour, continuation ON -> next available date, Hour 1.
n = await resolveRushNext('rush-vod-2005-06-03-h3', true, net({
  '/api/rush/episode/2005-06-03': json(day('2005-06-03', 3)),
  '/api/rush/next/2005-06-03': json({ currentDate: '2005-06-03', nextDate: '2005-06-06', ...day('2005-06-06', 3) }),
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
console.log('rush next (client) regression: all passed');
