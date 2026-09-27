// Offline regression: bounded fetch — every redirect hop checked, timeouts, size caps.
import assert from 'node:assert/strict';
import { safeFetch, readTextCapped, urlAllowed, anyPublicHost, SafeFetchError } from './server/safeFetch.ts';

const only = (h: string) => h === 'a.example' || h === 'b.example';
for (const bad of ['http://a.example/x', 'https://a.example:8443/x', 'https://u:p@a.example/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://10.1.2.3/', 'https://[::1]/', 'https://localhost/', 'https://metadata.google.internal/'])
  assert.ok(!urlAllowed(new URL(bad), anyPublicHost), `blocked: ${bad}`);
assert.ok(urlAllowed(new URL('https://a.example/x'), only));
assert.ok(!urlAllowed(new URL('https://evil.example/x'), only));

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const seen: string[] = [];
const net = (async (u: URL | string) => {
  const s = String(u); seen.push(s);
  if (s === 'https://a.example/ok') return redirect('https://b.example/final');
  if (s === 'https://b.example/final') return new Response('#EXTM3U\n');
  if (s === 'https://a.example/evil') return redirect('https://169.254.169.254/latest/meta-data');
  if (s === 'https://a.example/off') return redirect('https://evil.example/x');
  if (s === 'https://a.example/loop') return redirect('https://a.example/loop');
  if (s === 'https://a.example/slow') return new Promise<Response>(() => {});
  if (s === 'https://a.example/big') return new Response('x'.repeat(2000));
  throw new Error('unexpected ' + s);
}) as unknown as typeof fetch;

const ok = await safeFetch('https://a.example/ok', { allow: only, fetchImpl: net });
assert.equal(ok.finalUrl.toString(), 'https://b.example/final');
assert.equal(await ok.res.text(), '#EXTM3U\n');

const reason = async (p: Promise<unknown>) => { try { await p; return 'none'; } catch (e) { return e instanceof SafeFetchError ? e.reason : 'other:' + (e as Error).message; } };
seen.length = 0;
assert.equal(await reason(safeFetch('https://a.example/evil', { allow: anyPublicHost, fetchImpl: net })), 'redirect_blocked');
assert.ok(!seen.some((s) => s.includes('169.254')), 'private redirect target never requested');
assert.equal(await reason(safeFetch('https://a.example/off', { allow: only, fetchImpl: net })), 'redirect_blocked');
assert.equal(await reason(safeFetch('https://a.example/loop', { allow: only, fetchImpl: net })), 'too_many_redirects');
assert.equal(await reason(safeFetch('https://evil.example/x', { allow: only, fetchImpl: net })), 'blocked');

// The fake network ignores the abort signal, like a hung socket would; the timeout must still win.
const hung = (async (u: URL, init: RequestInit) => new Promise<Response>((_ok, fail) => init.signal!.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd
const t0 = Date.now();
assert.equal(await reason(safeFetch('https://a.example/slow', { allow: only, fetchImpl: hung, timeoutMs: 200 })), 'timeout');
assert.ok(Date.now() - t0 < 2000);
clearInterval(keepAlive);

const big = await safeFetch('https://a.example/big', { allow: only, fetchImpl: net });
assert.equal(await reason(readTextCapped(big.res, 1000)), 'too_large');
assert.equal(await readTextCapped(new Response('small'), 1000), 'small');
console.log('safe fetch regression: all passed');
