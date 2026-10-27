import assert from 'node:assert/strict';
import { createLastGoodCache } from './server/lastGoodCache';

const originalNow = Date.now;
const originalWarn = console.warn;
let now = 1_000;
Date.now = () => now;
const warnings: string[] = [];
console.warn = ((...args: unknown[]) => warnings.push(args.map(String).join(' '))) as typeof console.warn;

const flushBackground = () => new Promise<void>((resolve) => setImmediate(resolve));

try {
  const validCache = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => [1],
    isValid: (value) => value.length > 0,
    label: 'unit',
  });
  assert.deepEqual(await validCache.get('guide'), [1], 'valid snapshot is served');
  assert.deepEqual(validCache.meta('guide'), { stale: false });

  let invalidCalls = 0;
  const invalidCache = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => (++invalidCalls === 1 ? [7] : []),
    isValid: (value) => value.length > 0,
    label: 'invalid',
  });
  const previous = await invalidCache.get('guide');
  now += 101;
  assert.deepEqual(await invalidCache.get('guide'), previous, 'expired snapshot is returned immediately');
  await flushBackground();
  assert.deepEqual(invalidCache.meta('guide'), { stale: true, lastRefreshError: 'invalid value' });
  assert.ok(warnings.some((line) => line.includes('[invalid] guide refresh rejected: invalid value; keeping snapshot from')));

  let rejectCalls = 0;
  const rejectedCache = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => {
      rejectCalls += 1;
      if (rejectCalls === 1) return [9];
      throw new Error('upstream unavailable');
    },
    isValid: (value) => value.length > 0,
    label: 'rejected',
  });
  const rejectedPrevious = await rejectedCache.get('guide');
  now += 101;
  assert.deepEqual(await rejectedCache.get('guide'), rejectedPrevious, 'rejected refresh keeps last good');
  await flushBackground();
  assert.deepEqual(rejectedCache.meta('guide'), { stale: true, lastRefreshError: 'upstream unavailable' });

  let resolveConcurrent!: (value: number[]) => void;
  let concurrentCalls = 0;
  const concurrentCache = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: () => {
      concurrentCalls += 1;
      return new Promise<number[]>((resolve) => { resolveConcurrent = resolve; });
    },
    isValid: (value) => value.length > 0,
    label: 'concurrent',
  });
  const callers = Array.from({ length: 10 }, () => concurrentCache.get('guide'));
  await Promise.resolve();
  assert.equal(concurrentCalls, 1, 'concurrent cold reads share one load');
  resolveConcurrent([3]);
  assert.deepEqual(await Promise.all(callers), Array.from({ length: 10 }, () => [3]));

  const firstFailure = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => { throw new Error('first load failed'); },
    isValid: (value) => value.length > 0,
    label: 'first-failure',
  });
  await assert.rejects(firstFailure.get('guide'), /first load failed/, 'first-ever failure propagates');

  const firstInvalid = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => [],
    isValid: (value) => value.length > 0,
    label: 'first-invalid',
  });
  assert.deepEqual(await firstInvalid.get('guide'), [], 'first invalid value is propagated without fabrication');
  assert.deepEqual(firstInvalid.meta('guide'), { stale: true, lastRefreshError: 'invalid value' });

  console.log('guide snapshot last-good cache: all passed');
} finally {
  Date.now = originalNow;
  console.warn = originalWarn;
}
