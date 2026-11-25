import assert from 'node:assert/strict';
import { archiveRetryWaitMs, overloadedMessage, ARCHIVE_CIRCUIT_COOLDOWN_MS } from './src/utils/archiveFailure.ts';
import { buildArchiveProxyFailureReply } from './server/archiveProxyFailureCache.ts';
import { ArchiveHostCircuitBreaker } from './server/archiveFetch.ts';

const open = { errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN', retryAfterSeconds: 14 };
assert.equal(archiveRetryWaitMs(open), 14_000);
assert.equal(archiveRetryWaitMs({ errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN' }), ARCHIVE_CIRCUIT_COOLDOWN_MS, 'older server without the field → default 20 s');
assert.equal(archiveRetryWaitMs({ upstreamStatus: 502 }), 0, 'real Archive 5xx: retry is allowed now');
assert.equal(archiveRetryWaitMs(null), 0);
assert.match(overloadedMessage(open), /AJN proxy paused requests to this storage host\. Retry in about 14 s/);
assert.doesNotMatch(overloadedMessage(open), /overloaded/);
assert.match(overloadedMessage({ upstreamStatus: 502 }), /Archive upstream returned HTTP 502/);

const reply = buildArchiveProxyFailureReply({ upstreamStatus: 0, attempts: 0, proxyRequestId: 'r', errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN', retryAfterMs: 13_200 });
assert.equal(reply.status, 503);
assert.equal(reply.body.retryAfterSeconds, 14);
assert.equal(buildArchiveProxyFailureReply({ upstreamStatus: 502, attempts: 3, proxyRequestId: 'r', retryAfterMs: 5000 }).body.retryAfterSeconds, undefined, 'only circuit-open replies carry a wait');

const b = new ArchiveHostCircuitBreaker(3, 20_000, 90_000);
const host = 'ia800.us.archive.org';
assert.equal(b.recordTimeout(host, 'black-sheep', 1_000).distinctItems, 1);
assert.equal(b.recordTimeout(host, 'black-sheep', 2_000).distinctItems, 1);
assert.equal(b.recordTimeout(host, 'black-sheep', 3_000).opened, false, 'one repeatedly failing item cannot open the host circuit');
assert.equal(b.canRequest(host, 3_000), true, 'other items on the host remain eligible');
assert.equal(b.recordTimeout(host, 'brother-bear', 4_000).distinctItems, 2);
const systemic = b.recordTimeout(host, 'third-item', 5_000);
assert.equal(systemic.opened, true, 'three distinct failed items indicate a host-wide problem');
assert.equal(systemic.distinctItems, 3);
assert.equal(b.remainingMs(host, 5_000), 20_000);
assert.equal(b.remainingMs('IA800.US.ARCHIVE.ORG', 26_000), 0, 'host key is case-insensitive and cooldown expires');

const expiredWindow = new ArchiveHostCircuitBreaker(3, 20_000, 90_000);
expiredWindow.recordTimeout(host, 'old-a', 1_000);
expiredWindow.recordTimeout(host, 'old-b', 2_000);
const afterWindow = expiredWindow.recordTimeout(host, 'new-c', 92_001);
assert.equal(afterWindow.distinctItems, 1, 'distinct-item evidence expires outside the 90 s window');
assert.equal(afterWindow.opened, false);
console.log('PASS breaker fake-clock isolation: repeated single-item timeouts do not block other items; 3 distinct item failures open host for 20 s');
