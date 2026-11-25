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

  let ttlCalls = 0;
  const dynamicTtlCache = createLastGoodCache<{ status: string; version: number }>({
    ttlMs: 60_000,
    ttlFor: (value) => value.status === 'loading' ? 4_000 : 60_000,
    load: async () => {
      ttlCalls += 1;
      return { status: ttlCalls === 1 ? 'loading' : 'ready', version: ttlCalls };
    },
    isValid: () => true,
    label: 'ttl',
  });
  const loadingSnapshot = await dynamicTtlCache.get('guide');
  now += 4_001;
  assert.deepEqual(await dynamicTtlCache.get('guide'), loadingSnapshot, 'loading snapshot is returned while refreshing');
  await flushBackground();
  assert.equal(ttlCalls, 2, 'loading snapshot refreshes after its 4-second TTL');
  const readySnapshot = await dynamicTtlCache.get('guide');
  now += 4_001;
  assert.deepEqual(await dynamicTtlCache.get('guide'), readySnapshot, 'normal snapshot remains fresh after 4 seconds');
  assert.equal(ttlCalls, 2, 'normal snapshot keeps the full TTL');
  now += 56_001;
  assert.deepEqual(await dynamicTtlCache.get('guide'), readySnapshot, 'expired normal snapshot is returned during refresh');
  await flushBackground();
  assert.equal(ttlCalls, 3, 'normal snapshot refreshes after the full TTL');

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
  assert.deepEqual(await rejectedCache.get('guide'), rejectedPrevious, 'backoff keeps serving last good');
  assert.equal(rejectCalls, 2, 'a failed refresh is not retried within the backoff window');

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

  let firstFailureCalls = 0;
  const firstLoadError = new Error('first load failed');
  const firstFailure = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => {
      firstFailureCalls += 1;
      throw firstLoadError;
    },
    isValid: (value) => value.length > 0,
    label: 'first-failure',
  });
  await assert.rejects(firstFailure.get('guide'), (error) => error === firstLoadError, 'first-ever failure propagates');
  await assert.rejects(firstFailure.get('guide'), (error) => error === firstLoadError, 'cold failure rethrows its real error during backoff');
  assert.equal(firstFailureCalls, 1, 'cold failures are not retried during the backoff window');

  let firstInvalidCalls = 0;
  const firstInvalid = createLastGoodCache<number[]>({
    ttlMs: 100,
    load: async () => {
      firstInvalidCalls += 1;
      return [];
    },
    isValid: (value) => value.length > 0,
    label: 'first-invalid',
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(await firstInvalid.get('guide'), [], 'the real invalid value is propagated without fabrication');
  }
  assert.equal(firstInvalidCalls, 1, 'cold invalid results are reused during the backoff window');
  assert.deepEqual(firstInvalid.meta('guide'), { stale: true, lastRefreshError: 'invalid value' });

  const invalidProgramGuide = [{
    programs: [{ startTime: 10, endTime: 10 }],
  }];
  const guideValidityCache = createLastGoodCache({
    ttlMs: 100,
    load: async () => invalidProgramGuide,
    isValid: (channels: typeof invalidProgramGuide, guideId) => {
      const invalidProgramCount = channels.reduce(
        (count, channel) => count + channel.programs.filter((program) => program.endTime <= program.startTime).length,
        0,
      );
      if (invalidProgramCount > 0) {
        console.warn(`[Guide snapshot] ${guideId}: ${invalidProgramCount} programs with end<=start`);
      }
      return channels.length > 0 && channels.some((channel) => channel.programs.length > 0);
    },
    label: 'Guide snapshot',
  });
  assert.deepEqual(
    await guideValidityCache.get('guide'),
    invalidProgramGuide,
    'one end<=start program is logged but does not invalidate its guide',
  );
  assert.deepEqual(guideValidityCache.meta('guide'), { stale: false });
  assert.ok(warnings.some((line) => line.includes('[Guide snapshot] guide: 1 programs with end<=start')));

  console.log('guide snapshot last-good cache: all passed');
} finally {
  Date.now = originalNow;
  console.warn = originalWarn;
}
