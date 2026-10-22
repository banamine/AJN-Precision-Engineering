import assert from 'node:assert/strict';
import { classifyPublicationTime, CUBE_FRESHNESS_MS, CUBE_FUTURE_SKEW_MS } from './retention';

const now = Date.parse('2026-10-21T18:00:00.000Z');
assert.deepEqual(classifyPublicationTime(new Date(now).toUTCString(), now), { kind: 'eligible', publishedMs: now });
assert.deepEqual(classifyPublicationTime(new Date(now - CUBE_FRESHNESS_MS).toUTCString(), now), {
  kind: 'eligible',
  publishedMs: now - CUBE_FRESHNESS_MS,
});
assert.equal(classifyPublicationTime(new Date(now - CUBE_FRESHNESS_MS - 1000).toUTCString(), now).kind, 'outside-window');
assert.equal(classifyPublicationTime(new Date(now + CUBE_FUTURE_SKEW_MS).toUTCString(), now).kind, 'eligible');
assert.equal(classifyPublicationTime(new Date(now + CUBE_FUTURE_SKEW_MS + 1000).toUTCString(), now).kind, 'outside-window');
assert.equal(classifyPublicationTime('not a date', now).kind, 'no-date');
assert.equal(classifyPublicationTime(null, now).kind, 'no-date');
console.log('News Cube retention: PASS (48-hour read window, 10-minute future skew, invalid timestamps)');
