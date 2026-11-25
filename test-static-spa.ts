import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mountStaticSpa, MISSING_FILE_PATTERN } from './server/staticSpa.ts';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ajn-spa-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body>shell</body></html>');
fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'export const ok = 1;');
fs.writeFileSync(path.join(dist, 'manifest.json'), '{}');

const app = express();
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
mountStaticSpa(app, dist);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const get = (p: string, init?: RequestInit) => fetch(base + p, init);

try {
  let r = await get('/assets/index-abc123.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /javascript/);
  assert.match(r.headers.get('cache-control') ?? '', /immutable/);

  for (const p of ['/', '/onair', '/desk', '/tv-guide/classic-tv']) {
    r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/, p);
    assert.equal(r.headers.get('cache-control'), 'no-store', `${p} must be no-store`);
    assert.match(await r.text(), /shell/);
  }
  r = await get('/index.html');
  assert.equal(r.headers.get('cache-control'), 'no-store', '/index.html must be no-store');

  for (const p of ['/assets/old-hash.js', '/assets/old-hash.css', '/foo.js', '/foo.mjs', '/foo.wasm', '/foo.css', '/x/y.map', '/missing.json', '/missing.png']) {
    r = await get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
    assert.doesNotMatch(r.headers.get('content-type') ?? '', /html/, `${p} must never be text/html`);
  }
  r = await get('/manifest.json');
  assert.equal(r.status, 200, 'real public files still serve');
  r = await get('/api/nope');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') ?? '', /json/, '/api stays JSON');
  r = await get('/onair', { method: 'POST' });
  assert.notEqual(r.status, 200, 'POST is not answered with the shell');

  assert.ok(!MISSING_FILE_PATTERN.test('/onair') && !MISSING_FILE_PATTERN.test('/tv-guide/classic-tv'), 'page routes are not file-like');
  console.log('test-static-spa: ok');
} finally {
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
}
