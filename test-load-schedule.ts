import assert from 'node:assert/strict';
import { loadSchedule } from './src/guide/loadSchedule';
import { clearScheduleCache, getCachedSchedule, setCachedSchedule, STALE_AFTER_MS } from './src/guide/scheduleCache';
(async () => {
  let calls = 0; const urls: string[] = [];
  const ok = (async (u: any) => { calls++; urls.push(String(u)); await new Promise((r) => setTimeout(r, 20)); return { ok: true, json: async () => ({ channels: [{ id: 'a' }] }) } as any; }) as unknown as typeof fetch;
  clearScheduleCache();
  const [a, b] = await Promise.all([loadSchedule('g1', ok), loadSchedule('g1', ok)]);
  assert.equal(calls, 1, 'two simultaneous callers share one request');
  assert.equal(a, b); assert.ok(urls[0].includes('guide=g1') && urls[0].includes('tz='));
  await loadSchedule('g1', ok); assert.equal(calls, 1, 'later calls come from the cache');
  const bad = (async () => ({ ok: false, status: 503 }) as any) as unknown as typeof fetch;
  await assert.rejects(loadSchedule('g2', bad), /503/); assert.equal(getCachedSchedule('g2'), undefined, 'failure is not cached');
  const empty = (async () => ({ ok: true, json: async () => ({ channels: [] }) }) as any) as unknown as typeof fetch;
  await assert.rejects(loadSchedule('g3', empty), /no channels/);
  const retry = await loadSchedule('g2', ok); assert.equal(retry.length, 1, 'a failed load can be retried');
  // Stale cache (older than STALE_AFTER_MS) is refetched; if that refetch fails the old copy is still returned, never nothing.
  clearScheduleCache(); setCachedSchedule('g4', [{ id: 'old' }], Date.now() - STALE_AFTER_MS - 1000);
  const before = calls; const fresh = await loadSchedule('g4', ok); assert.equal(calls, before + 1, 'a stale cached guide is refetched');
  assert.equal((fresh as any)[0].id, 'a', 'the refetched copy replaces the stale one');
  clearScheduleCache(); setCachedSchedule('g5', [{ id: 'old' }], Date.now() - STALE_AFTER_MS - 1000);
  const kept = await loadSchedule('g5', bad); assert.equal((kept as any)[0].id, 'old', 'refetch failure falls back to the old copy');
  clearScheduleCache(); setCachedSchedule('g6', [{ id: 'young' }], Date.now() - 1000);
  const c0 = calls; await loadSchedule('g6', ok); assert.equal(calls, c0, 'a fresh cached guide is not refetched');
  console.log('[load-schedule] PASS');
})();
