import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { fnv, type PodcastEpisode, type PodcastState } from './podcasts';
import { ARCHIVE_AFTER_DAYS, BUILD_CONCURRENCY, WINDOW_DAYS, buildAlertsIndex, judgeAll, judgeFeed, kickBuild, matchIndex, registerAlertsRoutes, resetAlertsForTests, statusBody, whenBuilt, type BuildDeps, type TranscriptFetch } from './alertsIndex';
import type { AlertRule } from '../src/utils/alertMatch';

const NOW = new Date('2026-11-26T20:00:00Z'); const DAYMS = 86_400_000;
const srt = (lines: [number, string][]) => lines.map(([s, t], i) => { const f = (x: number) => `00:${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')},000`; return `${i + 1}\n${f(s)} --> ${f(s + 4)}\n${t}\n`; }).join('\n');
let seq = 0;
const ep = (id: string, daysOld: number, o: Partial<PodcastEpisode> = {}): PodcastEpisode => ({ guid: `${id}-g${daysOld}-${seq++}`, title: `${id} day ${daysOld}`, description: '', publishedAt: NOW.getTime() - daysOld * DAYMS, url: `https://cdn.example/${id}/${daysOld}-${seq}.mp3`, transcriptUrl: `https://t.example/${id}/${daysOld}.srt`, ...o });
const state = (id: string, eps: PodcastEpisode[], o: Partial<PodcastState> = {}, name = `Show ${id}`): PodcastState => ({
  source: { id, name, feedUrl: `https://f.example/${id}`, expectTitle: name, enabled: true }, status: 'ok', fetchedAt: NOW.toISOString(), feedTitle: name, episodes: eps, rejected: [], ...o });
/** n recent episodes (1..n days old); the first `withTr` carry a transcript link */
const mk = (id: string, n: number, withTr = n, startDay = 1) => Array.from({ length: n }, (_, i) => ep(id, startDay + i, i < withTr ? {} : { transcriptUrl: undefined }));
const judge = (s: PodcastState, owners = new Map<string, string>()) => judgeFeed(s, NOW, owners);

// ===== hygiene gate + eligibility (recomputed from the feed each time, never a fixed list)
assert.equal(judge(state('a', mk('a', 10))).status, 'covered');
assert.equal(judge(state('a', mk('a', 10, 8))).status, 'covered', '8 of 10 is exactly 80%: covered');
const seven = judge(state('a', mk('a', 10, 7)));
assert.equal(seven.status, 'uncovered', '7 of 10 is below the line'); assert.match(seven.reason, /7 of 10/);
assert.match(judge(state('a', mk('a', 10, 0))).reason, /publishes no transcripts/);
assert.equal(judge(state('a', mk('a', 4))).status, 'uncovered', 'too few episodes to judge'); assert.match(judge(state('a', mk('a', 4))).reason, /only 4/);
const old = judge(state('a', mk('a', 10, 10, ARCHIVE_AFTER_DAYS + 5)));
assert.equal(old.status, 'archive'); assert.match(old.reason, /days old/);
assert.equal(judge(state('a', mk('a', 10, 10, ARCHIVE_AFTER_DAYS - 2))).status, 'covered', 'newest episode inside 30 days stays active');
assert.equal(judge(state('a', [], { status: 'error', error: 'feed HTTP 404' })).status, 'quarantined'); assert.match(judge(state('a', [], { status: 'error', error: 'feed HTTP 404' })).reason, /404/);
assert.equal(judge(state('a', mk('a', 10), {}, 'Demo Feed')).status, 'quarantined', 'test-looking feed');
assert.equal(judge(state('a', mk('a', 10, 10), {}, 'The Protest Show')).status, 'covered', 'a word that merely contains "test" is fine');
const cloneOwners = new Map<string, string>(); const cloned = state('copy', mk('copy', 10)); for (const e of cloned.episodes) cloneOwners.set(e.url, 'original');
assert.equal(judge(cloned, cloneOwners).status, 'quarantined'); assert.match(judge(cloned, cloneOwners).reason, /original/);
const nonAudio = judge(state('a', mk('a', 10), { rejected: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, reason: 'enclosure is not audio (video/mp4)' })) }));
assert.equal(nonAudio.status, 'covered', 'non-audio items are dropped per item; the feed stays active'); assert.ok(nonAudio.warnings.some((w) => /5 of 15/.test(w)), 'but a feed-level warning is raised past 25%');
assert.equal(judge(state('a', mk('a', 10), { rejected: [{ id: 'r', reason: 'enclosure is not audio (video/mp4)' }] })).warnings.length, 0, '1 of 11 is noise');
const dupTitle = mk('a', 10); dupTitle[3] = { ...dupTitle[3], title: dupTitle[0].title, publishedAt: dupTitle[0].publishedAt - 600_000 };
assert.ok(judge(state('a', dupTitle)).warnings.some((w) => /within an hour/.test(w)), 'same title within an hour warns, never drops or multiplies silently');
const sameTitleWeekly = mk('a', 10); sameTitleWeekly[3] = { ...sameTitleWeekly[3], title: sameTitleWeekly[0].title };
assert.equal(judge(state('a', sameTitleWeekly)).warnings.length, 0, 'a recurring weekly title on different days is normal');
const all = judgeAll([state('first', mk('first', 10)), state('second', mk('second', 10).map((e, i) => ({ ...e, url: mk('first', 10)[0].url }))), state('third', mk('third', 10))], NOW);
assert.ok(all.length === 3);

// ===== building the index
const A = state('a', [...mk('a', 5), ep('a', WINDOW_DAYS + 6)]);                 // 5 in the window, 1 older than 14 days
const B = state('b', mk('b', 2, 2, ARCHIVE_AFTER_DAYS + 20).concat(mk('b', 8, 8, ARCHIVE_AFTER_DAYS + 30)));   // archive feed
const C = state('c', mk('c', 10, 0));                                            // uncovered
const bodies = new Map<string, string>();
for (const s of [A, B]) for (const e of s.episodes) bodies.set(e.transcriptUrl!, srt([[0, `Welcome to ${s.source.id}.`], [30, 'Tonight the Federal Reserve rate cut, and Acme Corp earnings.'], [400, 'Closing words about police and Acme.']]));
let inflight = 0; let maxInflight = 0; const calls: string[] = [];
const fakeFetch = (override: Record<string, TranscriptFetch> = {}) => async (url: string): Promise<TranscriptFetch> => {
  calls.push(url); inflight++; maxInflight = Math.max(maxInflight, inflight);
  await new Promise((r) => setTimeout(r, 5)); inflight--;
  return override[url] ?? (bodies.has(url) ? { ok: true, text: bodies.get(url)! } : { ok: false, reason: 'http', status: 404, message: 'HTTP 404' });
};
const deps = (over: Partial<BuildDeps> = {}): BuildDeps => ({ states: () => [A, B, C], fetchTranscript: fakeFetch(), now: () => NOW, wait: async () => {}, memory: () => ({ rssMB: 321, heapMB: 123 }), ...over });
let idx = await buildAlertsIndex(deps());
assert.equal(idx.stats.shows.covered, 1); assert.equal(idx.stats.shows.archive, 1); assert.equal(idx.stats.shows.uncovered, 1);
assert.equal(idx.stats.episodes.candidates, 5 + 10, 'A: 5 in the window (the 20-day-old one is skipped); B: the archive feed is indexed whatever its age');
assert.equal(idx.episodes.size, 15); assert.equal(idx.stats.episodes.indexed, 15);
assert.ok(!calls.some((u) => /a\/20\.srt/.test(u)), 'nothing older than the window is fetched for an active show');
assert.ok(maxInflight > 1 && maxInflight <= BUILD_CONCURRENCY, `fetches overlap but never exceed ${BUILD_CONCURRENCY} (saw ${maxInflight})`);
assert.equal(idx.stats.rssMB, 321); assert.ok(idx.stats.cues > 0 && idx.stats.durationMs >= 0 && idx.stats.builtAt);
const first = [...idx.episodes.values()].find((e) => e.ref.showId === 'a')!;
assert.equal(first.ref.programId, `pod-a-${fnv(first.ref.guid)}`, 'program id matches the guide row so the player treats it as a feed episode'); assert.equal(first.ref.channelId, 'pod-a'); assert.equal(first.ref.archive, false);
assert.equal([...idx.episodes.values()].find((e) => e.ref.showId === 'b')!.ref.archive, true);

// failures: retry once on 5xx/429/network, count them, never abort the rest
const eps = A.episodes.slice(0, 3); const [u1, u2, u3] = eps.map((e) => e.transcriptUrl!);
let n503 = 0; calls.length = 0;
const flaky = fakeFetch(); const failing: BuildDeps['fetchTranscript'] = async (url) => {
  if (url === u1 && n503++ === 0) return { ok: false, reason: 'http', status: 503, message: 'HTTP 503' };   // recovers on retry
  if (url === u2) return { ok: false, reason: 'http', status: 429, message: 'HTTP 429' };                    // never recovers
  if (url === u3) return { ok: false, reason: 'too_large', message: 'body exceeds' };
  return flaky(url);
};
idx = await buildAlertsIndex(deps({ states: () => [A], fetchTranscript: failing }));
assert.equal(idx.stats.retries, 2, 'one retry for the 503, one for the 429'); assert.equal(idx.stats.http.r5xx, 1); assert.equal(idx.stats.http.r429, 2);
assert.equal(idx.stats.episodes.indexed, 3, 'the recovered one and the two untouched'); assert.equal(idx.stats.episodes.failed, 1); assert.equal(idx.stats.episodes.oversized, 1);
idx = await buildAlertsIndex(deps({ states: () => [A], fetchTranscript: async (url) => url === u1 ? { ok: false, reason: 'network', message: 'ECONNRESET' } : url === u2 ? { ok: true, text: 'not a transcript at all' } : fakeFetch()(url) }));
assert.equal(idx.stats.episodes.failed, 1); assert.equal(idx.stats.episodes.noCues, 1); assert.equal(idx.stats.episodes.indexed, 3); assert.ok(idx.stats.http.otherErrors >= 1);

// rebuilds reuse what is already indexed (no second download), and drop what left the window
const prev = await buildAlertsIndex(deps());
calls.length = 0; const again = await buildAlertsIndex(deps(), prev);
assert.equal(calls.length, 0, 'second build downloads nothing'); assert.equal(again.stats.episodes.reused, 15); assert.equal(again.episodes.size, 15);
const shrunk = await buildAlertsIndex(deps({ states: () => [state('a', A.episodes.slice(0, 1))] }), prev);
assert.equal(shrunk.episodes.size, 0, 'not enough episodes left to be covered, so nothing is kept for it');

// matching
const rules: AlertRule[] = [{ id: 'r1', name: 'Competitors', enabled: true, scope: { kind: 'all' }, terms: [{ type: 'competitor', text: 'Acme Corp', aliases: ['Acme'] }, { type: 'topic', text: 'rate cut' }] }];
const m = matchIndex(prev, rules);
assert.equal(m.scanned, 15); assert.ok(m.hits.length >= 15, 'every indexed episode has the rate-cut cue');
const firstArchive = m.hits.findIndex((h) => h.archive); assert.ok(firstArchive > 0 && m.hits.slice(0, firstArchive).every((h) => !h.archive) && m.hits.slice(firstArchive).every((h) => h.archive), 'new hits first, library matches after');
const aHits = m.hits.filter((h) => h.showId === 'a'); assert.ok(aHits.every((h, i) => i === 0 || h.publishedAt <= aHits[i - 1].publishedAt || h.guid === aHits[i - 1].guid), 'newest first');
assert.equal(matchIndex(prev, [{ ...rules[0], scope: { kind: 'shows', showIds: ['b'] } }]).hits.every((h) => h.showId === 'b'), true);
assert.equal(matchIndex(prev, [{ ...rules[0], enabled: false }]).hits.length, 0); assert.equal(matchIndex(prev, []).hits.length, 0);
assert.equal(matchIndex(prev, [{ id: 'r2', name: 'x', enabled: true, scope: { kind: 'all' }, terms: [{ type: 'keyword', text: 'polic' }] }]).hits.length, 0, 'whole words only: "polic" is not "police"');

// ===== runtime + routes (a real HTTP round trip)
resetAlertsForTests();
const rt = { deps: deps(), ensureFeeds: async () => {} };
const app = express(); app.use(express.json()); registerAlertsRoutes(app, rt);
const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  let r = await fetch(`${base}/api/alerts/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
  assert.equal(r.status, 202, 'first request starts the build and says so'); let j: any = await r.json(); assert.equal(j.state, 'building'); assert.deepEqual(j.hits, []);
  await whenBuilt();
  let s: any = await (await fetch(`${base}/api/alerts/status`)).json();
  assert.equal(s.state, 'ready'); assert.equal(s.indexedEpisodes, 15); assert.deepEqual(s.covered.map((x: any) => x.showId), ['a']); assert.deepEqual(s.archive.map((x: any) => x.showId), ['b']);
  assert.deepEqual(s.uncovered.map((x: any) => x.showId), ['c']); assert.match(s.uncovered[0].reason, /no transcripts/); assert.equal(s.source, 'publisher transcript'); assert.equal(s.window.days, WINDOW_DAYS);
  assert.equal(s.stats.http.r429, 0);
  r = await fetch(`${base}/api/alerts/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
  j = await r.json(); assert.equal(r.status, 200); assert.equal(j.state, 'ready'); assert.ok(j.hits.length >= 15); assert.equal(j.hits[0].timing, 'clean-show'); assert.equal(j.hits[0].programId.startsWith('pod-'), true);
  assert.ok(!JSON.stringify(statusBody()).includes('Acme'), 'rules are never kept on the server');
  r = await fetch(`${base}/api/alerts/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: 'garbage' }) });
  j = await r.json(); assert.equal(r.status, 200); assert.deepEqual(j.hits, []); assert.equal(j.rules, 0);
  assert.equal(r.headers.get('cache-control'), 'no-store');
} finally { server.close(); }

// a build that throws is reported, not hidden, and retried only after 2 minutes
resetAlertsForTests(); let tries = 0;
const bad = { deps: deps({ states: () => { tries++; throw new Error('feeds exploded'); } }), ensureFeeds: async () => {} };
kickBuild(bad, 1_000_000); await whenBuilt();
assert.equal(statusBody().state, 'error'); assert.match(statusBody().error!, /feeds exploded/); assert.equal(tries, 1);
kickBuild(bad, 1_000_000 + 60_000); await whenBuilt(); assert.equal(tries, 1, 'no retry inside 2 minutes');
kickBuild(bad, 1_000_000 + 130_000); await whenBuilt(); assert.equal(tries, 2, 'retries after 2 minutes');
resetAlertsForTests();
console.log('alertsIndex tests passed');
