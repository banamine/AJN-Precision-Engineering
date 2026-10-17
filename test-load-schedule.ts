import assert from 'node:assert/strict';
import { loadSchedule } from './src/guide/loadSchedule';
import { clearScheduleCache, getCachedSchedule } from './src/guide/scheduleCache';
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
  console.log('[load-schedule] PASS');
})();
