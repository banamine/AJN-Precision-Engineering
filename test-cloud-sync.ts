import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { syncRecentlyPlayed, toSyncPayload, SYNC_ENDPOINT } from './src/utils/cloudSync';
import { registerSyncPlaceholder, validateSyncBody, SYNC_PATH } from './server/routes/syncPlaceholder';
import { DevModeView } from './src/components/DevModeView';
import type { RecentlyPlayedItem } from './src/types';

assert.equal(SYNC_ENDPOINT, SYNC_PATH);
const item = (n: number): RecentlyPlayedItem => ({ id: `id${n}`, title: `T${n}`, src: `/api/x/${n}`, progressSeconds: n * 10, updatedAt: 1_000 + n, mediaType: 'audio', secretField: 'x' } as any);
const items = [item(1), item(2)];

// payload carries only the whitelisted fields
const payload = toSyncPayload(items, 0);
assert.equal(payload.version, 1); assert.equal(payload.items.length, 2);
assert.ok(!('secretField' in payload.items[0]));

// server validation
assert.equal(validateSyncBody(null).ok, false);
assert.equal(validateSyncBody({ version: 2, items: [] }).ok, false);
assert.equal(validateSyncBody({ version: 1, items: new Array(51).fill(payload.items[0]) }).ok, false);
assert.equal(validateSyncBody({ version: 1, items: [{ id: 'a', title: 'b' }] }).ok, false);
assert.equal(validateSyncBody({ version: 1, items: [{ ...payload.items[0], progressSeconds: -1 }] }).ok, false);
assert.equal(validateSyncBody(payload).ok, true);

// real route over HTTP: 202, placeholder:true, stored:false; bad body -> 400 with a reason
const app = express(); app.use(express.json()); registerSyncPlaceholder(app);
const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const ok = await syncRecentlyPlayed(items, (u, init) => fetch(base + String(u), init));
  assert.ok(ok.ok && ok.received === 2 && ok.stored === false && ok.placeholder === true);
  const bad = await fetch(base + SYNC_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, items: 'nope' }) });
  assert.equal(bad.status, 400);
  const get = await fetch(base + SYNC_PATH); assert.equal(get.status, 404); // POST only
} finally { server.close(); }

// client failure paths are explicit
assert.deepEqual(await syncRecentlyPlayed([]), { ok: false, reason: 'Nothing to sync: play something first.' });
const down = await syncRecentlyPlayed(items, async () => { throw new Error('offline'); });
assert.ok(down.ok === false && /Network error: offline/.test(down.reason));
const srvErr = await syncRecentlyPlayed(items, async () => new Response(JSON.stringify({ error: 'Item 1 needs id' }), { status: 400 }));
assert.ok(srvErr.ok === false && /Item 1 needs id/.test(srvErr.reason));
const http500 = await syncRecentlyPlayed(items, async () => new Response('x', { status: 500 }));
assert.ok(http500.ok === false && /HTTP 500/.test(http500.reason));

// the button exists in Settings with the usage instructions
const html = renderToStaticMarkup(createElement(DevModeView, { onNavigate: () => {}, recentlyPlayed: items }));
assert.match(html, /Sync to cloud/); assert.match(html, /data-testid="dev-settings"/);
assert.match(html, /How to use/); assert.match(html, /placeholder/); assert.match(html, /Not synced in this session/);
console.log('cloud sync: all passed');
