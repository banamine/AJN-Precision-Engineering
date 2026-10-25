import assert from 'node:assert/strict';
import { archiveRetryWaitMs, overloadedMessage, ARCHIVE_CIRCUIT_COOLDOWN_MS } from './src/utils/archiveFailure.ts';
import { buildArchiveProxyFailureReply } from './server/archiveProxyFailureCache.ts';
import { ArchiveHostCircuitBreaker } from './server/archiveFetch.ts';

const open = { errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN', retryAfterSeconds: 14 };
assert.equal(archiveRetryWaitMs(open), 14_000);
assert.equal(archiveRetryWaitMs({ errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN' }), ARCHIVE_CIRCUIT_COOLDOWN_MS, 'older server without the field → default 20 s');
assert.equal(archiveRetryWaitMs({ upstreamStatus: 502 }), 0, 'real Archive 5xx: retry is allowed now');
assert.equal(archiveRetryWaitMs(null), 0);
assert.match(overloadedMessage(open), /This Archive storage server isn't responding\. The app will try it again in about 14 s/);
assert.doesNotMatch(overloadedMessage(open), /overloaded/);
assert.match(overloadedMessage({ upstreamStatus: 502 }), /Archive's servers are overloaded right now \(HTTP 502\)/);

const reply = buildArchiveProxyFailureReply({ upstreamStatus: 0, attempts: 0, proxyRequestId: 'r', errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN', retryAfterMs: 13_200 });
assert.equal(reply.status, 503);
assert.equal(reply.body.retryAfterSeconds, 14);
assert.equal(buildArchiveProxyFailureReply({ upstreamStatus: 502, attempts: 3, proxyRequestId: 'r', retryAfterMs: 5000 }).body.retryAfterSeconds, undefined, 'only circuit-open replies carry a wait');

const b = new ArchiveHostCircuitBreaker(3, 20_000);
b.recordTimeout('ia800.us.archive.org', 1_000); b.recordTimeout('ia800.us.archive.org', 1_000);
assert.equal(b.remainingMs('ia800.us.archive.org', 1_000), 0);
b.recordTimeout('ia800.us.archive.org', 1_000);
assert.equal(b.remainingMs('ia800.us.archive.org', 6_000), 15_000);
assert.equal(b.remainingMs('IA800.US.ARCHIVE.ORG', 21_001), 0);
console.log('PASS circuit-open replies carry the remaining pause; honest wording; Retry waits only for our own pause');
