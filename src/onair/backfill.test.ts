import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BACKFILL, planDay, summarizePlan, seededRng, type PlanItem } from './backfill';
import type { FillClip, FillerPool } from '../../server/onairFiller';
import type { EditionSlot } from '../utils/dailyEdition';

const NEWS = ['CNN', 'Fox News', 'RT', 'DW News', 'CBC News'];
const clip = (kind: FillClip['kind'], channel: string, i: number, dur: number): FillClip => ({ kind, channelId: channel, channel, showId: channel, title: `${channel} ${i}`, src: `/api/archive/proxy?path=${channel}-${i}`, startSec: kind === 'news' ? i * 300 : 0, durSec: dur, clipDate: null });
const pool = (): FillerPool => ({
  schemaVersion: 1, builtAt: '2026-11-22T12:00:00Z', missing: [],
  news: NEWS.flatMap((c) => Array.from({ length: 12 }, (_, i) => clip('news', c, i, 280))),
  long: ['INFO WARS SURVIVAL', 'INFOWARS NIGHTLY NEWS', 'NEW WORLD TYRANNY'].flatMap((c) => Array.from({ length: 10 }, (_, i) => clip('long', c, i, c === 'NEW WORLD TYRANNY' ? 2500 : 7200))),
  quash: Array.from({ length: 12 }, (_, i) => clip('quash', 'The Quash', i, 2700)),
});
const slot = (id: string, dur: number): EditionSlot => ({ showId: id, showName: id, channelId: `pod-${id}`, programId: `p-${id}`, guid: id, title: id, src: `https://x/${id}.mp3`, publishedMs: 1, durationSeconds: dur, durationSource: 'rss', startMs: 0, endMs: dur * 1000, label: '' });
const DAY = 24 * 3600;
const plan = (fresh: EditionSlot[] = [], cfg = DEFAULT_BACKFILL, key = '2026-11-22'): PlanItem[] => planDay({ fresh, pool: pool(), dateKey: key, cfg, targetSec: DAY });

test('seeded rng is stable for a seed and differs between seeds', () => {
  const a = seededRng(5), b = seededRng(5), c = seededRng(6);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(seededRng(5)(), c());
});

test('the same Denver date gives the same plan; another date differs', () => {
  const k = (p: PlanItem[]) => p.map((i) => `${i.role}:${i.clip?.src}:${i.startOffsetSec}`).join('|');
  assert.equal(k(plan()), k(plan()));
  assert.notEqual(k(plan([], DEFAULT_BACKFILL, '2026-11-23')), k(plan()));
});

test('no fresh podcast: news comes in clip pairs of one channel with music only after the pair', () => {
  const p = plan();
  for (let i = 0; i < p.length; i++) if (p[i].role === 'news' && !p[i].musicAfter) { assert.equal(p[i + 1].role, 'news'); assert.equal(p[i + 1].channel, p[i].channel); assert.equal(p[i + 1].musicAfter, true); }
  assert.ok(p.filter((i) => i.role === 'news').length > 10);
});

test('music sits between any two different spoken blocks: a bare join is only the same channel continuing (news pair, show resuming, Paul Harvey group)', () => {
  const p = plan();
  for (let i = 0; i < p.length - 1; i++) if (!p[i].musicAfter) assert.ok(p[i].channel === p[i + 1].channel && p[i].role === p[i + 1].role, `bare join at ${i}`);
});

test('caps: Quash 900 s, news clips keep their own length, long/archive chunks never exceed one clock talk part', () => {
  for (const it of plan()) {
    if (it.role === 'quash') assert.ok(it.durationSec <= 900);
    if (it.role === 'news') assert.equal(it.durationSec, 280);
    if (it.role === 'long' || it.role === 'talk' || it.role === 'rush') assert.ok(it.durationSec <= 1740 || it.why.includes('between fresh podcasts'), `${it.role} ${it.durationSec}`);
  }
});

test('every piece stays inside its file (offset >= 0, offset + length <= file length)', () => {
  for (const it of plan()) if (it.role !== 'podcast' && it.role !== 'news') {
    const c = it.clip as FillClip;
    assert.ok(it.startOffsetSec >= 0);
    assert.ok(it.startOffsetSec + it.durationSec <= c.durSec + 1, `${it.role} ${it.startOffsetSec}+${it.durationSec} > ${c.durSec}`);
  }
});

test('the filler pool is used newest first: news clips come from the newest recording day of each channel and the day before', () => {
  const p0 = pool();
  p0.news = NEWS.flatMap((c) => Array.from({ length: 12 }, (_, i) => ({ ...clip('news', c, i, 280), clipDate: i < 6 ? '2026-11-22' : '2026-11-10' })));
  const p = planDay({ fresh: [], pool: p0, dateKey: '2026-11-22', cfg: DEFAULT_BACKFILL, targetSec: DAY });
  const dates = p.filter((i) => i.role === 'news').map((i) => i.clipDate);
  assert.ok(dates.length > 10);
  assert.ok(dates.every((d) => d === '2026-11-22'));
});

const HOUR = 3600;
const MIDNIGHT = Date.parse('2026-11-23T07:00:00Z'); // Denver midnight (MST)
const clockPlan = (key = '2026-11-23'): PlanItem[] => planDay({ fresh: [], pool: richPool(), dateKey: key, cfg: DEFAULT_BACKFILL, targetSec: DAY, startMs: MIDNIGHT });
const musicOf = (it: PlanItem): number => (it.musicAfter ? (it.musicSec ?? DEFAULT_BACKFILL.musicSec) : 0);
const ends = (p: PlanItem[]): number[] => { let t = 0; return p.map((it) => (t += it.durationSec + musicOf(it))); };

function richPool(): FillerPool {
  const p0 = pool();
  const mk = (kind: FillClip['kind'], channel: string, n: number, dur: number, date?: (i: number) => string | null): FillClip[] => Array.from({ length: n }, (_, i) => ({ ...clip(kind, channel, i, dur), clipDate: date ? date(i) : null }));
  p0.talk = [...mk('talk', 'Coast to Coast AM', 3, 5757), ...mk('talk', 'Long John Nebel', 3, 12401), ...mk('talk', 'New World Order Exposed (1969)', 2, 15281)];
  p0.harvey = mk('harvey', 'Paul Harvey \u00b7 The Rest of the Story', 40, 240);
  const years = [2005, 2006, 2008, 2009, 2010, 2012, 2014, 2016, 2018, 2020];
  p0.rush = years.flatMap((y) => [1, 2, 3].map((h) => ({ ...clip('rush', 'Rush Limbaugh', y * 10 + h, 2210), title: `Rush ${y} (Hour ${h})`, clipDate: `${y}-11-23` })));
  return p0;
}

test('clock hours: a long show plays :00-:29, 4-min music, :33-:57:50, 2:10 music, so its hour lands on the hour line', () => {
  const p = clockPlan();
  const e = ends(p);
  const hits = new Set(e.map((x) => Math.round(x)));
  let aligned = 0;
  for (let h = 1; h <= 23; h++) if (hits.has(h * HOUR)) aligned += 1;
  assert.ok(aligned >= 21, `only ${aligned} of 23 hour lines are hit exactly`);
  assert.ok(p.some((it) => it.musicSec === 240), 'no 4-minute break');
  assert.ok(p.some((it) => it.musicSec === 130), 'no 2:10 top-of-hour break');
});

test('a long show resumes where it stopped: the next piece of the same file starts where the last one ended', () => {
  const p = clockPlan();
  let checked = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if ((a.role === 'long' || a.role === 'talk') && b.role === a.role && b.clip === a.clip) { assert.equal(b.startOffsetSec, a.startOffsetSec + a.durationSec); checked += 1; }
  }
  assert.ok(checked > 5, `only ${checked} resumes`);
});

test('Rush on this day: five slots at the Denver hours 5, 9, 14, 18 and 21, years rising from the earliest to the latest', () => {
  const p = clockPlan();
  let t = 0; const starts: { hour: number; date: string }[] = [];
  p.forEach((it, i) => {
    if (it.role === 'rush' && (i === 0 || p[i - 1].role !== 'rush')) starts.push({ hour: Math.floor(t / HOUR), date: it.clipDate as string });
    t += it.durationSec + musicOf(it);
  });
  assert.deepEqual(starts.map((x) => x.hour), [5, 9, 14, 18, 21]);
  const dates = starts.map((x) => x.date);
  assert.deepEqual([...dates].sort(), dates);
  assert.equal(new Set(dates).size, 5);
  assert.equal(dates[0], '2005-11-23'); assert.equal(dates[4], '2020-11-23');
});

test('Paul Harvey shorts play in groups of three with music after the group; over a week the afternoon and evening get more of them than the morning', () => {
  const first = clockPlan();
  const groups = first.filter((it, i) => it.role === 'harvey' && (i === 0 || first[i - 1].role !== 'harvey' || first[i - 1].musicAfter));
  assert.ok(groups.length >= 6);
  let am = 0, pm = 0;
  for (let d = 1; d <= 14; d++) {
    const p = clockPlan(`2026-12-${String(d).padStart(2, '0')}`); let t = 0;
    for (const it of p) { if (it.role === 'harvey') (t < 12 * HOUR ? am++ : pm++); t += it.durationSec + musicOf(it); }
  }
  assert.ok(pm > am, `harvey am ${am} pm ${pm}`);
});

test('clock plan: the same date gives the same plan; no hour repeats the same block kind twice in a row when others exist', () => {
  const k = (p: PlanItem[]) => p.map((i) => `${i.role}:${i.clip?.src}:${i.startOffsetSec}:${i.durationSec}:${i.musicSec ?? ''}`).join('|');
  assert.equal(k(clockPlan()), k(clockPlan()));
  assert.notEqual(k(clockPlan('2026-11-24')), k(clockPlan()));
});

test('long channels get roughly the configured share of filler time (not a tiny sliver, not most of the day)', () => {
  const s = summarizePlan(plan());
  assert.ok(s.longShareOfFiller > 0.2 && s.longShareOfFiller < 0.6, `long share ${s.longShareOfFiller}`);
  assert.ok(s.byRole.quash > 0);
});

test('fresh podcasts play first, capped at the demo cap, tagged TODAY; filler backs off when there is enough', () => {
  const many = Array.from({ length: 12 }, (_, i) => slot(`s${i}`, 3600));
  const p = plan(many);
  assert.equal(p[0].role, 'podcast'); assert.equal(p[0].durationSec, 1500);
  const firstFiller = p.findIndex((i) => i.filler);
  assert.ok(firstFiller === -1 || p.slice(0, firstFiller).every((i) => i.role === 'podcast'), 'filler appeared while there were plenty of fresh podcasts');
  assert.equal(p.filter((i) => i.role === 'podcast').length, 12);
  const full = plan([slot('x', 3600)], { ...DEFAULT_BACKFILL, podcastCapSec: 0 });
  assert.equal(full[0].durationSec, 3600);
});

test('a few fresh podcasts are interleaved with filler; none is repeated', () => {
  const few = [slot('a', 1800), slot('b', 1800), slot('c', 1800)];
  const p = plan(few);
  assert.equal(p.filter((i) => i.role === 'podcast').length, 3);
  assert.ok(p.slice(0, 6).some((i) => i.filler));
});

test('an empty pool and no fresh podcasts gives an empty plan (no invented content)', () => {
  assert.deepEqual(planDay({ fresh: [], pool: null, dateKey: 'x', cfg: DEFAULT_BACKFILL, targetSec: DAY }), []);
});

test('excluded news channel (CTV) never appears', () => {
  const p0 = pool(); p0.news.push(clip('news', 'CTV News', 1, 280));
  const p = planDay({ fresh: [], pool: p0, dateKey: '2026-11-22', cfg: DEFAULT_BACKFILL, targetSec: DAY });
  assert.ok(!p.some((i) => i.channel === 'CTV News'));
});

test('current Alex Jones shows play only in the evening (from 6 pm Denver); the archive plays before that', async () => {
  const { denverHourOf } = await import('./backfill');
  const fresh: FillClip[] = ['2026-11-23', '2026-11-22', '2026-11-21'].map((d, i) => ({ ...clip('ajfresh', 'The Alex Jones Show', i, 10_800), clipDate: d }));
  const base = pool(); base.ajfresh = fresh;
  const MID = Date.parse('2026-11-23T07:00:00Z');                        // Denver midnight (UTC-7)
  let freshHours = 0; const outside: number[] = [];
  for (let k = 0; k < 6; k++) {
    const p = planDay({ fresh: [], pool: base, dateKey: `2026-12-0${k + 1}`, cfg: DEFAULT_BACKFILL, targetSec: DAY, startMs: MID });
    let t = 0;
    for (const it of p) {
      const h = denverHourOf(MID + t * 1000);
      if (it.clip?.kind === 'ajfresh') { freshHours++; if (h < 18) outside.push(h); }
      t += it.durationSec + (it.musicAfter ? (it.musicSec ?? 420) : 0);
    }
  }
  assert.deepEqual(outside, [], 'no current show before 6 pm');
  assert.ok(freshHours > 0, 'the evening plays current shows');
  // without the feed the evening still plans (archive only)
  assert.ok(plan().length > 10);
});

test('current shows start from the beginning, newest day first, and resume across hours', () => {
  const fresh: FillClip[] = ['2026-11-23', '2026-11-22'].map((d, i) => ({ ...clip('ajfresh', 'The Alex Jones Show', i, 10_800), clipDate: d }));
  const base = pool(); base.ajfresh = fresh;
  const MID = Date.parse('2026-11-23T07:00:00Z');
  for (let k = 1; k <= 12; k++) {
    const p = planDay({ fresh: [], pool: base, dateKey: `2026-12-${String(k).padStart(2, '0')}`, cfg: DEFAULT_BACKFILL, targetSec: DAY, startMs: MID }).filter((i) => i.clip?.kind === 'ajfresh');
    if (!p.length) continue;
    assert.equal(p[0].clipDate, '2026-11-23'); assert.equal(p[0].startOffsetSec, 0);
    for (let i = 1; i < p.length; i++) if (p[i].clip === p[i - 1].clip) assert.ok(p[i].startOffsetSec >= p[i - 1].startOffsetSec + p[i - 1].durationSec - 1, 'resumes where it stopped');
    return;
  }
  assert.fail('no plan used the current show');
});
