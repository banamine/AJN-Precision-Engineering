import assert from 'node:assert/strict';
import { resolveEnclosure, setPodcastFetchForTests } from './server/podcasts.ts';
const hops = ['https://a.example/x.mp3', 'https://b.example/y', 'https://c.example/z', 'https://d.example/1', 'https://e.example/2', 'https://f.example/3', 'https://cdn.example/final.mp3?sig=1'];
const calls: string[] = [];
const fake = (async (u: any, init: any) => {
  const url = String(u); calls.push(url);
  assert.equal(init.headers.Range, 'bytes=0-0');
  const i = hops.indexOf(url);
  if (i >= 0 && i < hops.length - 1) return new Response(null, { status: 302, headers: { location: hops[i + 1] } });
  return new Response('x', { status: 206, headers: { 'content-type': 'audio/mpeg' } });
}) as typeof fetch;
setPodcastFetchForTests(fake);
const r = await resolveEnclosure(hops[0]);
assert.equal(r.url, hops[hops.length - 1], 'walks 6 redirects (more than the old limit of 5)');
assert.equal(calls.length, 7);
// non-audio final answer is an explicit error
setPodcastFetchForTests((async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch);
await assert.rejects(resolveEnclosure('https://x.example/page'), /not audio/);
// redirect to a private address is refused
setPodcastFetchForTests((async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a.mp3' } })) as typeof fetch);
await assert.rejects(resolveEnclosure('https://y.example/a'), /not allowed/);
console.log('podcast resolve: all passed');
