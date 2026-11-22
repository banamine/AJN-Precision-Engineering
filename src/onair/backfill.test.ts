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

test('music sits between any two different spoken blocks (musicAfter on every block that ends a unit)', () => {
  const p = plan();
  for (let i = 0; i < p.length - 1; i++) if (!p[i].musicAfter) assert.ok(p[i].role === 'news' && p[i + 1].role === 'news' && p[i].channel === p[i + 1].channel, `bare join at ${i}`);
});

test('caps: long 720 s (76: 900 s), Quash 900 s, news clips keep their own length', () => {
  for (const it of plan()) {
    if (it.role === 'long') assert.ok(it.durationSec <= (it.channel === 'NEW WORLD TYRANNY' ? 900 : 720));
    if (it.role === 'quash') assert.ok(it.durationSec <= 900);
    if (it.role === 'news') assert.equal(it.durationSec, 280);
  }
});

test('offsets stay inside the file: at least 120 s in, and the piece ends 900 s before the end', () => {
  for (const it of plan()) if ((it.role === 'long' || it.role === 'quash') && it.startOffsetSec > 0) {
    assert.ok(it.startOffsetSec >= 120);
    assert.ok(it.startOffsetSec + it.durationSec <= (it.clip as FillClip).durSec - 900 + 1);
  }
  const off = plan([], { ...DEFAULT_BACKFILL, useOffsets: false });
  for (const it of off) if (it.role === 'long' || it.role === 'quash') assert.equal(it.startOffsetSec, 0);
});

test('never the same clip twice in a row, and never the same news channel back to back', () => {
  const p = plan();
  for (let i = 1; i < p.length; i++) assert.notEqual(`${p[i].clip?.src}#${p[i].clip?.startSec}`, `${p[i - 1].clip?.src}#${p[i - 1].clip?.startSec}`);
  const blocks = p.filter((i) => i.role === 'news' && !i.musicAfter);
  const firstOfBlock = p.filter((it, idx) => it.role === 'news' && (idx === 0 || p[idx - 1].musicAfter || p[idx - 1].role !== 'news'));
  for (let i = 1; i < firstOfBlock.length; i++) if (blocks.length > 2) assert.ok(firstOfBlock[i].channel !== firstOfBlock[i - 1].channel || p.indexOf(firstOfBlock[i]) - p.indexOf(firstOfBlock[i - 1]) > 3);
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
