import assert from 'node:assert/strict';
import { createChannelSchedulePool } from './src/guide/channelSchedulePool';

const pool = createChannelSchedulePool(4);
let active = 0;
let maxActive = 0;
let started = 0;
const jobs = Array.from({ length: 9 }, (_, index) => {
  const controller = new AbortController();
  const promise = pool.run(async (signal) => {
    assert.equal(signal.aborted, false);
    started++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15 + (index % 3) * 4));
    active--;
    return index;
  }, controller.signal);
  return { controller, promise };
});

const output = await Promise.all(jobs.map((job) => job.promise));
assert.deepEqual(output, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(started, 9);
assert.equal(maxActive, 4);
assert.deepEqual(pool.snapshot(), { active: 0, queued: 0 });

const cancellationPool = createChannelSchedulePool(1);
const firstController = new AbortController();
let releaseFirst: (() => void) | undefined;
const first = cancellationPool.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }), firstController.signal);
const queuedController = new AbortController();
let queuedStarted = false;
const queued = cancellationPool.run(async () => { queuedStarted = true; return 'unexpected'; }, queuedController.signal);
queuedController.abort();
await assert.rejects(queued, { name: 'AbortError' });
releaseFirst?.();
await first;
assert.equal(queuedStarted, false);
assert.deepEqual(cancellationPool.snapshot(), { active: 0, queued: 0 });

console.log('PASS channel-schedule-pool: max concurrency 4; queued abort removes job before execution');
