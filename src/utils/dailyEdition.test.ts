import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketOf, buildEdition, denverDayLengthMs, denverMidnight, formatDenverClock, orderBundle, parseDenverDateTime, showRulesFromSources, validateDailyConfig, feedRevision,
  type DailySourceConfig, type FeedEpisode, type FeedInput, type ShowRule,
} from './dailyEdition';
import { EDITION_FIXTURE } from './dailyEdition.testdata';
import sourcesJson from '../data/podcastSources.json';

const BENCH_TO_REAL: Record<string, string> = {
  'red-eye': 'red-eye-radio', fox: 'fox-news-rundown', 'pat-gray': 'pat-gray', kuhner: 'kuhner-report', kyle: 'kyle-seraphin', bannon: 'bannon-war-room', 'clay-buck': 'clay-buck',
  mats: 'mats-trucking-great', trish: 'trish-regan', kirk: 'charlie-kirk', c2c: 'coast-to-coast', ben: 'ben-ferguson', tucker: 'tucker-carlson', 'lead-pedal': 'lead-pedal',
  savage: 'savage-nation', talkcdl: 'talkcdl', 'jeff-fisher': 'jeff-fisher', radiolab: 'radiolab', 'truck-n-hustle': 'truck-n-hustle', quash: 'quash', rush: 'rush-limbaugh-wisdom',
};
const sources = (sourcesJson as unknown as { sources: DailySourceConfig[] }).sources;
const RULES: ShowRule[] = showRulesFromSources(sources);
const T0130 = parseDenverDateTime('2026-11-20 01:30');
type Probe = 'on' | 'off';
function feedsFrom(opts: { probe?: Probe; shift?: number; rules?: ShowRule[]; only?: string[] } = {}): FeedInput[] {
  const probe = opts.probe ?? 'on'; const shift = (opts.shift ?? 0) * 86_400_000;
  const byReal: Record<string, FeedEpisode[]> = {};
  for (const [benchId, rows] of Object.entries(EDITION_FIXTURE)) {
    const real = BENCH_TO_REAL[benchId];
    byReal[real] = rows.map((r, i) => {
      const pub = r[1] === null ? null : Date.parse(String(r[1])) + shift;
      const mins = r[2] as number | null; const demo = r.length >= 5 ? (r[4] as number) : null;
      const e: FeedEpisode = { guid: `${real}::${r[1]}::${r[0]}`, programId: `pod-${real}-${i}`, title: String(r[0]), src: `https://media.example/${real}/${i}-${String(r[1])}.mp3`, publishedMs: pub };
      if (mins !== null) { e.durationSeconds = mins * 60; e.durationSource = 'rss'; }
      else if (demo !== null && probe === 'on') { e.durationSeconds = demo * 60; e.durationSource = 'probed'; }
      else e.durationEstimated = true;
      return e;
    });
  }
  return (opts.rules ?? RULES).map((rule) => ({ rule, episodes: byReal[rule.id] ?? [] }));
}
const loopIds = (feeds: FeedInput[], now: number): string[] => buildEdition(feeds, now).loop.map((s) => `${s.showId}:${s.title}`);

test('show rules come from podcastSources.json: 19 daily shows in the owner\'s order, quash and rush excluded', () => {
  assert.deepEqual(validateDailyConfig(sources), []);
  const order = RULES.filter((r) => r.mode !== 'exclude').map((r) => r.id);
  assert.deepEqual(order.slice(0, 7), ['red-eye-radio', 'fox-news-rundown', 'pat-gray', 'kuhner-report', 'kyle-seraphin', 'bannon-war-room', 'clay-buck']);
  assert.equal(order.length, 19);
  assert.deepEqual(RULES.filter((r) => r.mode === 'exclude').map((r) => r.id).sort(), ['quash', 'rush-limbaugh-wisdom']);
});
test('config validation rejects unknown mode, bad regex, maxEpisodes < 1, duplicate priority', () => {
  assert.equal(validateDailyConfig([{ id: 'a', name: 'a', dailyMode: 'capped' }]).length, 1);
  assert.equal(validateDailyConfig([{ id: 'a', name: 'a', dailyMode: 'bundle', includeTitle: '(' }]).length, 1);
  assert.equal(validateDailyConfig([{ id: 'a', name: 'a', maxEpisodes: 0 }]).length, 1);
  assert.equal(validateDailyConfig([{ id: 'a', name: 'a', dailyPriority: 1 }, { id: 'b', name: 'b', dailyPriority: 1 }]).length, 1);
  assert.deepEqual(showRulesFromSources([{ id: 'x', name: 'x' }, { id: 'y', name: 'y', dailyPriority: 1 }]).map((r) => r.id), ['y', 'x'], 'unconfigured feeds default to newest, after the table');
});

test('T01/T02 day order and Denver start times at 2026-11-20 01:30', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  const titles = ed.loop.map((s) => `${s.showId}:${s.title}`);
  assert.equal(titles.length, 22);
  assert.deepEqual(titles.slice(0, 10), [
    'red-eye-radio:11-19-26 Part One - The Healthcare Is A Right Argument', "red-eye-radio:11-19-26 Part Two - Musk Says He's Not MAGA",
    'fox-news-rundown:Is America Ready For AI Attacks?', "fox-news-rundown:President Trump's Historic Talks With Xi and Putin", 'pat-gray:Pat Gray Unleashed (Nov 19)',
    "kuhner-report:He's My Friend", 'kuhner-report:Was the Summit a Dud?', 'kuhner-report:Stocking Up!', 'kuhner-report:Foreign Actors, Hackers or Rogue AI?', 'kyle-seraphin:The Kyle Seraphin Show (Nov 19)']);
  const firstStart: Record<string, string> = {};
  for (const s of ed.loop) firstStart[s.showId] ??= formatDenverClock(s.startMs);
  assert.deepEqual(firstStart, { 'red-eye-radio': '12:00 am', 'fox-news-rundown': '1:54 am', 'pat-gray': '2:46 am', 'kuhner-report': '4:27 am', 'kyle-seraphin': '6:58 am', 'bannon-war-room': '9:38 am',
    'clay-buck': '1:18 pm', 'mats-trucking-great': '3:09 pm', 'trish-regan': '3:51 pm', 'charlie-kirk': '4:53 pm', 'coast-to-coast': '6:07 pm', 'ben-ferguson': '6:26 pm' });
  assert.equal(formatDenverClock(ed.loopEndMs), '6:54 pm');
  assert.equal(Math.round((ed.loopEndMs - ed.startMs) / 60000), 18 * 60 + 54);
});
test('T03 Red Eye Part One plays before Part Two although Part Two has the older timestamp', () => {
  const re = buildEdition(feedsFrom(), T0130).loop.filter((s) => s.showId === 'red-eye-radio');
  assert.ok(re[0].title.includes('Part One') && re[1].title.includes('Part Two'));
  assert.ok((re[1].publishedMs as number) < (re[0].publishedMs as number));
});
test('T04 Clay & Buck: Hours 1, 2, 3 only; the network\'s other shows are out of the loop', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  const cb = ed.loop.filter((s) => s.showId === 'clay-buck').map((s) => s.title);
  assert.deepEqual(cb, ['Hour 1 - Explain the Math, Zohran', 'Hour 2 - Anyone But a White Guy Can Say This', 'Hour 3 - Social Security Ponzi Scheme?']);
  const out = ed.shelves.notInLoop.filter((x) => x.show.id === 'clay-buck' && x.reason === 'title-excluded').length;
  assert.equal(out, 7);
});
test('T05 Fox plays exactly its 2 newest episodes, once, oldest first', () => {
  const fox = buildEdition(feedsFrom(), T0130).loop.filter((s) => s.showId === 'fox-news-rundown').map((s) => s.title);
  assert.deepEqual(fox, ['Is America Ready For AI Attacks?', "President Trump's Historic Talks With Xi and Putin"]);
});
test('T06 Bannon: probe off = all four in Not in loop (duration-estimated); probe on = 5820, 5821, EP 2032, 5822', () => {
  const off = buildEdition(feedsFrom({ probe: 'off' }), T0130);
  assert.equal(off.loop.filter((s) => s.showId === 'bannon-war-room').length, 0);
  assert.equal(off.shelves.notInLoop.filter((x) => x.show.id === 'bannon-war-room' && x.reason === 'duration-estimated').length, 4);
  const on = buildEdition(feedsFrom({ probe: 'on' }), T0130).loop.filter((s) => s.showId === 'bannon-war-room');
  assert.deepEqual(on.map((s) => s.title.slice(0, 20)), ['Episode 5820: Dems P', 'Episode 5821: Messag', 'WarRoom Battleground', 'Episode 5822: With C']);
  assert.ok(on.every((s) => s.durationSource === 'probed'));
});
test('T07 shows with no episode in the window are listed with their last published date; none is empty or hidden', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  for (const id of ['tucker-carlson', 'lead-pedal', 'savage-nation', 'talkcdl', 'jeff-fisher', 'radiolab', 'truck-n-hustle']) {
    const row = ed.shelves.notInLoop.find((x) => x.show.id === id && x.reason === 'no-episode-in-window');
    assert.ok(row, id); assert.ok(row!.note.startsWith('No new episode · last published '), row!.note); assert.ok(row!.episode, `${id} stays playable on demand`);
  }
});
test('T08 excluded shows never appear in the loop, tail or shelves', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  const bad = new Set(['quash', 'rush-limbaugh-wisdom']);
  for (const s of [...ed.loop, ...ed.tail]) assert.ok(!bad.has(s.showId));
  for (const s of [...ed.shelves.new, ...ed.shelves.missed]) assert.ok(!bad.has(s.showId));
  assert.equal(ed.shelves.notInLoop.filter((x) => bad.has(x.show.id) && x.reason === 'excluded').length, 2);
});
test('T09 every episode is in exactly one bucket', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  assert.equal(ed.counts.new + ed.counts.candidate + ed.counts.missed + ed.counts.older, ed.counts.total);
});
test('T10 interval boundaries: exactly at C = new, P1 = candidate, P2 = missed, one ms before P2 = not listed', () => {
  const C = denverMidnight(T0130, 0), P1 = denverMidnight(T0130, -1), P2 = denverMidnight(T0130, -2);
  assert.equal(bucketOf(C, T0130), 'new'); assert.equal(bucketOf(C - 1, T0130), 'candidate');
  assert.equal(bucketOf(P1, T0130), 'candidate'); assert.equal(bucketOf(P1 - 1, T0130), 'missed');
  assert.equal(bucketOf(P2, T0130), 'missed'); assert.equal(bucketOf(P2 - 1, T0130), 'older');
  assert.equal(bucketOf(T0130 + 1, T0130), 'future'); assert.equal(bucketOf(null, T0130), 'older');
});
test('T11 Denver day length: 25 h when DST ends, 23 h when it starts, 24 h otherwise', () => {
  assert.equal(denverDayLengthMs(parseDenverDateTime('2026-11-01 12:00')) / 3_600_000, 25);
  assert.equal(denverDayLengthMs(parseDenverDateTime('2027-03-14 12:00')) / 3_600_000, 23);
  assert.equal(denverDayLengthMs(T0130) / 3_600_000, 24);
  const fall = buildEdition(feedsFrom({ shift: -19 }), parseDenverDateTime('2026-11-01 12:00'));
  assert.equal(fall.lengthMs / 3_600_000, 25);
});
test('T12 duplicate GUIDs and duplicate media URLs are counted once', () => {
  const clean = loopIds(feedsFrom(), T0130);
  const dup = feedsFrom().map((f) => ({ ...f, episodes: f.episodes.flatMap((e, i) => Array.from({ length: (i % 3) + 2 }, () => e)) }));
  assert.deepEqual(loopIds(dup, T0130), clean);
  const sameUrl = feedsFrom().map((f) => ({ ...f, episodes: f.episodes.flatMap((e) => [e, { ...e, guid: `${e.guid}-other` }]) }));
  assert.deepEqual(loopIds(sameUrl, T0130), clean);
});
test('T13 tail: Yesterday episodes in the same order from 6:54 pm; the item crossing the end is not cut; then Replay', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  assert.equal(formatDenverClock(ed.tail[0].startMs), '6:54 pm'); assert.equal(ed.tail[0].label, 'Yesterday'); assert.equal(ed.tail[0].showId, 'red-eye-radio');
  const last = ed.tail[ed.tail.length - 1];
  assert.ok(last.endMs >= ed.endMs, 'the tail fills the edition');
  assert.equal(last.endMs - last.startMs, last.durationSeconds * 1000, 'never cut');
  assert.ok(ed.tail.slice(0, -1).every((s) => s.startMs < ed.endMs));
  assert.deepEqual(ed.tail.map((s) => s.label).filter((l, i, a) => a.indexOf(l) === i), ['Yesterday']);
  const small = feedsFrom({ rules: RULES.filter((r) => ['pat-gray', 'ben-ferguson'].includes(r.id)) });
  const e2 = buildEdition(small, T0130);
  assert.ok(e2.tail.some((s) => s.label === 'Replay'), 'with little yesterday material the day\'s list repeats as Replay');
});
test('no rollover: an episode that did not fit is not promoted to the next day', () => {
  const ed = buildEdition(feedsFrom(), parseDenverDateTime('2026-11-21 01:30'));
  assert.equal(ed.loop.length, 0, 'nothing published on Nov 20 means an empty list, not yesterday\'s episodes promoted');
  assert.ok(ed.tail.length > 0 && ed.tail.every((s) => s.label === 'Yesterday' || s.label === 'Replay'));
});
test('T17 a new episode changes the New shelf only: loop and editionId are unchanged', () => {
  const base = buildEdition(feedsFrom(), T0130);
  const feeds = feedsFrom();
  const fox = feeds.find((f) => f.rule.id === 'fox-news-rundown')!;
  fox.episodes = [{ guid: 'new-1', programId: 'pod-fox-new', title: 'Injected', src: 'https://media.example/new.mp3', publishedMs: T0130 - 60_000, durationSeconds: 900, durationSource: 'rss' }, ...fox.episodes];
  const after = buildEdition(feeds, T0130);
  assert.equal(after.shelves.new.length, base.shelves.new.length + 1);
  assert.equal(after.editionId, base.editionId);
  assert.deepEqual(after.loop.map((s) => s.guid), base.loop.map((s) => s.guid));
});
test('estimated and unknown durations never air (edge-case table)', () => {
  const feeds = feedsFrom();
  const kyle = feeds.find((f) => f.rule.id === 'kyle-seraphin')!;
  kyle.episodes = kyle.episodes.map((e) => ({ ...e, durationSeconds: undefined, durationEstimated: false }));
  const ed = buildEdition(feeds, T0130);
  assert.ok(!ed.loop.some((s) => s.showId === 'kyle-seraphin'));
  assert.ok(ed.shelves.notInLoop.some((x) => x.show.id === 'kyle-seraphin' && x.reason === 'duration-unknown'));
});
test('feed states: loading is not empty; stale feeds are labeled', () => {
  const feeds = feedsFrom();
  feeds.find((f) => f.rule.id === 'kyle-seraphin')!.loading = true;
  feeds.find((f) => f.rule.id === 'radiolab')!.stale = true;
  const ed = buildEdition(feeds, T0130);
  assert.equal(ed.shelves.notInLoop.find((x) => x.show.id === 'kyle-seraphin')!.reason, 'loading');
  assert.equal(ed.shelves.notInLoop.find((x) => x.show.id === 'radiolab')!.reason, 'stale-feed');
});
test('bundle order: Red Eye by Part number, Clay & Buck by Hour, Bannon by time then number, Kuhner by time then reverse feed position', () => {
  const mk = (title: string, i: number, pub: number): FeedEpisode & { feedIndex: number } => ({ guid: title, programId: title, title, src: title, publishedMs: pub, feedIndex: i });
  assert.deepEqual(orderBundle('part-number', [mk('x Part Two', 0, 1), mk('x Part One', 1, 2)]).map((e) => e.title), ['x Part One', 'x Part Two']);
  assert.deepEqual(orderBundle('part-number', [mk('Hour 1', 0, 3), mk('Hour 2', 1, 2), mk('Hour 3', 2, 1)]).map((e) => e.title), ['Hour 1', 'Hour 2', 'Hour 3']);
  assert.deepEqual(orderBundle('published-then-number', [mk('WarRoom EP 2032', 0, 5), mk('Episode 5822', 1, 5), mk('Episode 5821', 2, 1)]).map((e) => e.title), ['Episode 5821', 'WarRoom EP 2032', 'Episode 5822']);
  assert.deepEqual(orderBundle('published-asc', [mk('b', 0, 1), mk('a', 1, 1)]).map((e) => e.title), ['a', 'b'], 'tie: the item lower in the feed (older) first');
});
test('two independent builds are identical; the fixed order does not depend on the day', () => {
  assert.deepEqual(buildEdition(feedsFrom(), T0130), buildEdition(feedsFrom(), T0130));
  const nextDay = buildEdition(feedsFrom({ shift: 1 }), parseDenverDateTime('2026-11-21 01:30'));
  assert.deepEqual(nextDay.loop.map((s) => s.showId), buildEdition(feedsFrom(), T0130).loop.map((s) => s.showId));
});
test('editions cross UTC midnight without clipping, and DST days have 23/25 h lengths', () => {
  const ed = buildEdition(feedsFrom(), T0130);
  assert.ok(ed.loop.some((s) => s.startMs < Date.UTC(2026, 10, 21) && s.endMs > Date.UTC(2026, 10, 21)) || ed.tail.some((s) => s.startMs < Date.UTC(2026, 10, 21) && s.endMs > Date.UTC(2026, 10, 21)), 'a slot spans UTC midnight whole');
});
test('feedRevision changes when a relevant episode or duration changes, not otherwise', () => {
  const a = feedRevision(feedsFrom(), T0130);
  assert.equal(a, feedRevision(feedsFrom(), T0130));
  assert.notEqual(a, feedRevision(feedsFrom({ probe: 'off' }), T0130));
  const old = feedsFrom(); old.find((f) => f.rule.id === 'truck-n-hustle')!.episodes[0].title = 'changed';
  assert.equal(a, feedRevision(old, T0130), 'an episode older than P2 is not part of the revision');
});

test('an episode cover (artUrl) is carried onto its edition slot', () => {
  const feeds = feedsFrom().map((f) => ({ ...f, episodes: f.episodes.map((e) => ({ ...e, artUrl: `https://img.example/${f.rule.id}.jpg` })) }));
  const ed = buildEdition(feeds, T0130);
  const slots = [...ed.loop, ...ed.tail];
  assert.ok(slots.length > 0);
  for (const sl of slots) assert.equal(sl.artUrl, `https://img.example/${sl.showId}.jpg`);
});
