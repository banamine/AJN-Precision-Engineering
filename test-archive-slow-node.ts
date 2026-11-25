import assert from 'node:assert/strict';
import * as F from './server/archiveFetch.ts';
const { fetchArchiveMediaWithRetry, resetArchiveFetchStateForTests, markArchiveNodeSlow, isArchiveNodeSlow } = F;
const mk = (calls: string[], slowHost = 'ia800903.us.archive.org') => (async (url: any) => {
  const u = String(url); calls.push(u);
  const h = new URL(u).hostname;
  if (u.startsWith('https://archive.org/metadata/')) return new Response(JSON.stringify({ dir: '/9/items/x', server: 'ia800903.us.archive.org', d1: 'ia800903.us.archive.org', d2: 'ia600903.us.archive.org' }), { status: 200 });
  if (h === 'archive.org') return new Response(null, { status: 302, headers: { location: `https://${slowHost}/9/items/x/a.mp4` } });
  return new Response('ok', { status: 206 });
}) as typeof fetch;
const log = () => {};
// 1: slow-marked primary -> replica used
resetArchiveFetchStateForTests(); markArchiveNodeSlow('ia800903.us.archive.org');
let calls: string[] = [];
let r = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {} });
assert.equal(r.response?.status, 206);
assert.ok(calls.some((c) => c.includes('ia600903')), 'replica requested: ' + calls.join(' | '));
assert.ok(!calls.some((c) => c.startsWith('https://ia800903')), 'slow node requested: ' + calls.join(' | '));
// 2: not marked -> primary used, no replica
resetArchiveFetchStateForTests(); calls = [];
r = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {} });
assert.ok(calls.some((c) => c.startsWith('https://ia800903')) && !calls.some((c) => c.includes('ia600903')));
// 3: slow header latency marks node (injected clock)
resetArchiveFetchStateForTests(); calls = [];
let t = 0; const clock = () => (t += 9000);
r = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {}, headerBudgetNow: clock, totalHeaderWaitMs: 1e9 });
assert.equal(isArchiveNodeSlow('ia800903.us.archive.org'), true);
// 4: all replicas slow/unavailable -> falls back to slow primary, still 206
resetArchiveFetchStateForTests(); markArchiveNodeSlow('ia800903.us.archive.org'); markArchiveNodeSlow('ia600903.us.archive.org'); calls = [];
r = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {} });
assert.equal(r.response?.status, 206); assert.ok(calls.some((c) => c.startsWith('https://ia800903')));
// 5: fast response clears mark
resetArchiveFetchStateForTests(); markArchiveNodeSlow('ia800903.us.archive.org'); markArchiveNodeSlow('ia600903.us.archive.org'); calls = [];
await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {} });
assert.equal(isArchiveNodeSlow('ia800903.us.archive.org'), false);
// 6: open circuit -> result and reply body name the host
{
  const { buildArchiveProxyFailureReply } = await import('./server/archiveProxyFailureCache.ts');
  resetArchiveFetchStateForTests();
  for (const id of ['a','b','c']) F.archiveHostCircuitBreaker.recordTimeout('archive.org', id);
  calls = [];
  const rr = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {}, attempts: 1 });
  assert.equal(rr.errorCode, 'AJN_UPSTREAM_CIRCUIT_OPEN', JSON.stringify(rr));
  assert.equal(rr.host, 'archive.org');
  const reply = buildArchiveProxyFailureReply({ upstreamStatus: 0, attempts: 0, proxyRequestId: 'p', errorCode: rr.errorCode, retryAfterMs: rr.retryAfterMs, host: rr.host });
  assert.equal(reply.status, 503); assert.equal(reply.body.host, 'archive.org');
  const plain = buildArchiveProxyFailureReply({ upstreamStatus: 404, attempts: 1, proxyRequestId: 'p', host: 'ia800903.us.archive.org' });
  assert.equal(plain.body.host, undefined);
}
// 7: skipNodeProbe -> node requested once (media only); default -> twice (probe + media)
{
  const nodeHits = (c: string[]) => c.filter((u) => u.startsWith('https://ia800903')).length;
  resetArchiveFetchStateForTests(); calls = [];
  let rr = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {}, skipNodeProbe: true });
  assert.equal(rr.response?.status, 206); assert.equal(nodeHits(calls), 1, 'no probe: ' + calls.join(' | '));
  resetArchiveFetchStateForTests(); calls = [];
  rr = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: mk(calls), log, sleep: async () => {} });
  assert.equal(rr.response?.status, 206); assert.equal(nodeHits(calls), 2, 'default probes: ' + calls.join(' | '));
}
// 8: node-side redirect is followed (bounded) and re-validated when the probe is skipped
{
  resetArchiveFetchStateForTests(); const hits: string[] = [];
  const impl = (async (url: any) => {
    const u = String(url); hits.push(u); const h = new URL(u).hostname;
    if (h === 'archive.org') return new Response(null, { status: 302, headers: { location: 'https://ia800903.us.archive.org/9/items/x/a.mp4' } });
    if (h === 'ia800903.us.archive.org') return new Response(null, { status: 302, headers: { location: 'https://ia600903.us.archive.org/9/items/x/a.mp4' } });
    return new Response('ok', { status: 206 });
  }) as typeof fetch;
  const rr = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: impl, log, sleep: async () => {}, skipNodeProbe: true });
  assert.equal(rr.response?.status, 206, hits.join(' | '));
  // off-list redirect target is rejected, never fetched
  resetArchiveFetchStateForTests(); const hits2: string[] = [];
  const evil = (async (url: any) => {
    const u = String(url); hits2.push(u); const h = new URL(u).hostname;
    if (h === 'archive.org') return new Response(null, { status: 302, headers: { location: 'https://ia800903.us.archive.org/a.mp4' } });
    return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/a.mp4' } });
  }) as typeof fetch;
  const bad = await fetchArchiveMediaWithRetry('https://archive.org/download/x/a.mp4', { headers: {}, fetchImpl: evil, log, sleep: async () => {}, skipNodeProbe: true });
  assert.equal(bad.response, null); assert.ok(!hits2.some((u) => u.includes('evil.example.com')), 'evil host fetched');
}
console.log('slow-node tests passed');
