import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditionService } from './podcastEdition';
import { parseDenverDateTime } from '../src/utils/dailyEdition';
import type { PodcastSource, PodcastState } from './podcasts';

const mk = (id: string, p: number): PodcastSource => ({ id, name: id, feedUrl: `https://f.example/${id}`, expectTitle: id, enabled: true, dailyPriority: p } as PodcastSource);
const SOURCES = [mk('a', 1), mk('b', 2)];
const NOON = parseDenverDateTime('2026-11-20 12:00');
const T0010 = parseDenverDateTime('2026-11-20 00:05');
const T0030 = parseDenverDateTime('2026-11-20 00:30');

function stateOf(s: PodcastSource, fetchedMs: number, pubMs: number, dur?: number): PodcastState {
  return { source: s, status: 'ok', fetchedAt: new Date(fetchedMs).toISOString(), episodes: [{ guid: `${s.id}-g`, title: `${s.id} ep`, description: '', publishedAt: pubMs, url: `https://m.example/${s.id}.mp3`, durationSeconds: dur }], rejected: [] };
}
function harness(over: { failB?: boolean; hang?: boolean } = {}) {
  const cache = new Map<string, PodcastState>(); let refreshCalls = 0; let nowMs = T0010;
  const svc = createEditionService({
    sources: SOURCES, attempts: 2, attemptTimeoutMs: 50, degradedAfterMs: 10 * 60_000,
    refresh: async (s, _n) => { refreshCalls++; if (over.hang) await new Promise((r) => setTimeout(r, 200));
      if (over.failB && s.id === 'b') throw new Error('boom'); const st = stateOf(s, Date.now() + 1_000_000_000, nowMs - 3_600_000, 1800); cache.set(s.id, st); return st; },
    states: () => [...cache.values()],
    probe: async () => 2400,
  });
  return { svc, cache, calls: () => refreshCalls, setNow: (n: number) => { nowMs = n; } };
}

test('builds only after the pre-build refresh completes; memoizes for the whole Denver day', async () => {
  const h = harness();
  const first = await h.svc.get(T0010);
  assert.ok(first.editionStatus === 'building' || first.edition, 'first call starts the refresh');
  await new Promise((r) => setTimeout(r, 20));
  const second = await h.svc.get(T0010 + 5000);
  assert.equal(second.editionStatus, 'ok'); assert.equal(second.degraded, false); assert.ok(second.edition);
  const callsAfterBuild = h.calls();
  const later = await h.svc.get(NOON);
  assert.equal(later.edition!.editionId, second.edition!.editionId, 'same day: identical edition');
  assert.equal(h.calls(), callsAfterBuild, 'no further refresh for the same day');
  assert.equal(second.edition!.loop.length, 2);
  assert.deepEqual(second.edition!.loop.map((s) => s.showId), ['a', 'b']);
});
test('a hung refresh: status building, then degraded after C+10 min with the stale feeds named', async () => {
  const h = harness({ hang: true });
  const early = await h.svc.get(T0010);
  assert.equal(early.editionStatus, 'building'); assert.equal(early.edition, null);
  const late = await h.svc.get(parseDenverDateTime('2026-11-20 00:11'));
  assert.equal(late.editionStatus, 'degraded'); assert.equal(late.degraded, true); assert.deepEqual(late.staleFeeds.sort(), ['a', 'b']);
  assert.ok(late.edition, 'built from last-good data (empty here), never an exception');
});
test('one feed failing all attempts: edition is built, flagged degraded, failed feed listed', async () => {
  const h = harness({ failB: true });
  await h.svc.get(T0010); await new Promise((r) => setTimeout(r, 30));
  const r = await h.svc.get(T0030);
  assert.equal(r.editionStatus, 'degraded'); assert.deepEqual(r.staleFeeds, ['b']);
  assert.deepEqual(r.edition!.loop.map((s) => s.showId), ['a']);
});
test('missing durations are probed once; a failed probe leaves the episode out of the loop', async () => {
  const cache = new Map<string, PodcastState>(); let probes = 0;
  const svc = createEditionService({ sources: SOURCES, attempts: 1, attemptTimeoutMs: 50,
    refresh: async (s) => { const st = stateOf(s, Date.now() + 1e9, T0010 - 3_600_000, undefined); cache.set(s.id, st); return st; },
    states: () => [...cache.values()], probe: async (k) => { probes++; return k.startsWith('a') ? 3000 : null; } });
  await svc.get(T0010); await new Promise((r) => setTimeout(r, 20));
  const r = await svc.get(T0010 + 1000);
  assert.deepEqual(r.edition!.loop.map((s) => `${s.showId}:${s.durationSource}`), ['a:probed']);
  assert.ok(r.edition!.shelves.notInLoop.some((x) => x.show.id === 'b' && x.reason === 'duration-estimated'));
  await svc.get(T0010 + 2000); assert.equal(probes, 2, 'probe results are cached');
});
