import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARCHIVE_PROXY_FAILURE_TTL_MS,
  buildArchiveProxyFailureReply,
  clearArchiveProxyFailureCacheForTests,
  getRecentArchiveProxyFailure,
  rememberArchiveProxyFailure,
  rememberArchiveProxyFailureForDiagnostic,
} from './server/archiveProxyFailureCache.ts';
import { archiveFailureDiagnosticUrl, classifyArchiveFailure } from './src/utils/archiveFailure.ts';

const timeout = buildArchiveProxyFailureReply({
  upstreamStatus: 0,
  attempts: 3,
  proxyRequestId: 'proxy-timeout-1',
  errorCode: 'UND_ERR_CONNECT_TIMEOUT',
});
assert.equal(timeout.status, 504);
assert.equal(timeout.body.errorCode, 'UND_ERR_CONNECT_TIMEOUT');
assert.equal(classifyArchiveFailure(504, timeout.body), 'slow');
const budgetFailure = buildArchiveProxyFailureReply({
  upstreamStatus: 0,
  attempts: 3,
  proxyRequestId: '12345678-1234-1234-1234-123456789abc',
  errorCode: 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED',
});
assert.equal(budgetFailure.status, 504);
assert.equal(classifyArchiveFailure(504, budgetFailure.body), 'slow');

const open = buildArchiveProxyFailureReply({
  upstreamStatus: 0,
  attempts: 0,
  proxyRequestId: 'proxy-open-1',
  errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN',
});
assert.equal(open.status, 503);
assert.equal(classifyArchiveFailure(503, open.body), 'slow');
assert.equal(open.body.errorCode, 'AJN_UPSTREAM_CIRCUIT_OPEN');

clearArchiveProxyFailureCacheForTests();
rememberArchiveProxyFailure('/download/item/audio.mp3', timeout, 1000);
rememberArchiveProxyFailureForDiagnostic('/download/item/outage.mp4', timeout, 1000);
const copy = getRecentArchiveProxyFailure('/download/item/audio.mp3', 1001);
assert.deepEqual(copy, timeout);
assert.deepEqual(getRecentArchiveProxyFailure('/download/item/outage.mp4', 1001), timeout, 'outage diagnostics remain available to the player');
copy!.body.error = 'mutated caller copy';
assert.equal(getRecentArchiveProxyFailure('/download/item/audio.mp3', 1002)?.body.error, timeout.body.error);
assert.equal(getRecentArchiveProxyFailure('/download/item/audio.mp3', 1000 + ARCHIVE_PROXY_FAILURE_TTL_MS), null);

assert.equal(
  archiveFailureDiagnosticUrl('/api/archive/proxy?path=%2Fdownload%2Fitem%2Faudio.mp3&start=0&end=282'),
  '/api/archive/proxy?path=%2Fdownload%2Fitem%2Faudio.mp3&start=0&end=282&diagnostic=1',
);
assert.equal(archiveFailureDiagnosticUrl('https://archive.org/download/item/audio.mp3'), null);

const playerSource = readFileSync(new URL('./src/MinimalPlayer.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
assert.match(playerSource, /archiveFailureDiagnosticUrl/);
assert.match(playerSource, /fetch\(diagnosticUrl/);
assert.doesNotMatch(playerSource, /fetch\(failedSrc0/);
assert.doesNotMatch(playerSource, /fetch\(failedSrc,/);
assert.match(playerSource, /archiveIdentifier: archiveIdentifierFromPath/);
assert.match(playerSource, /proxyRequestId: proxyFailure\?\.proxyRequestId/);
assert.match(playerSource, /Archive proxy media failed; browser HTTP cause unavailable/);
assert.match(serverSource, /req\.query\.diagnostic === '1'/);
assert.match(serverSource, /getRecentArchiveProxyFailure\(v\.cleanPath\)/);
assert.match(serverSource, /rememberArchiveProxyFailureForDiagnostic\(v\.cleanPath, reply\)/);
assert.match(serverSource, /setHeader\('x-proxy-request-id'/);

const typicalBody = buildArchiveProxyFailureReply({
  upstreamStatus: 0,
  attempts: 3,
  proxyRequestId: '12345678-1234-1234-1234-123456789abc',
  errorCode: 'AJN_UPSTREAM_HEADER_TIMEOUT',
}).body;
const typicalJson = JSON.stringify(typicalBody);
const typicalJsonBytes = Buffer.byteLength(typicalJson, 'utf8');
assert.equal(typicalJsonBytes, 197, 'current structured timeout diagnostic serialization size');
console.log(`typical Archive proxy timeout body bytes: ${typicalJsonBytes}`);
console.log('archive proxy failure cache, truthful 502/503/504 mapping, and diagnostic URL checks: PASS');
