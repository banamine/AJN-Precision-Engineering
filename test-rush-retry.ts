import assert from 'node:assert/strict';
process.env.RUSH_CACHE_FILE = '/tmp/ajn-test-rush-retry.json';
const { resolveRushItem, setRushFetchForTests, rushStats } = await import('./server/rush.ts');
let n = 0;
setRushFetchForTests((async () => {
  n++;
  if (n === 1) throw new Error('ECONNRESET');
  if (n === 2) return new Response('bad gateway', { status: 502 });
  return new Response(JSON.stringify({ files: [{ name: 'h1.mp3', source: 'original', length: '3600' }] }), { status: 200 });
}) as typeof fetch);
const r = await resolveRushItem('rush-test');
assert.equal(r.tracks.length, 1); assert.equal(n, 3, 'two transient failures retried, third attempt succeeded');
let m = 0;
setRushFetchForTests((async () => { m++; return new Response('nf', { status: 404 }); }) as typeof fetch);
await assert.rejects(resolveRushItem('gone'), /metadata HTTP 404/); assert.equal(m, 1, '404 is definite: no retry');
console.log('rush retry: all passed');
