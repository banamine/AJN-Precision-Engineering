// AJN network guard. Preload it for ANY test or script that could reach the network:
//   node --import ./tools/net-guard.mjs <script.mjs>
//   node --import ./tools/net-guard.mjs --import tsx <script.ts>      (or: NODE_OPTIONS="--import ./tools/net-guard.mjs" npx tsx test.ts)
// Counts every outbound attempt (fetch, http.request/get, https.request/get) and BLOCKS non-allowed hosts before any packet is sent.
// Env: NET_GUARD=block (default) | count     ALLOW_HOSTS=localhost,127.0.0.1 (comma list, exact host match)
//      NET_GUARD_LOG=<file.ndjson>            NET_GUARD_BUDGET_HOSTS=archive.org (hosts to total separately; suffix match)
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';

const mode = process.env.NET_GUARD === 'count' ? 'count' : 'block';
const allow = new Set((process.env.ALLOW_HOSTS || 'localhost,127.0.0.1,::1,[::1]').split(',').map((s) => s.trim()).filter(Boolean));
const watch = (process.env.NET_GUARD_BUDGET_HOSTS || 'archive.org').split(',').map((s) => s.trim()).filter(Boolean);
const log = process.env.NET_GUARD_LOG;
const stats = { attempts: 0, blocked: 0, allowedLocal: 0, byHost: {}, watched: 0 };

function note(kind, host, path) {
  stats.attempts++;
  const local = allow.has(host);
  const isWatched = watch.some((w) => host === w || host.endsWith('.' + w));
  if (local) stats.allowedLocal++;
  if (isWatched) stats.watched++;
  stats.byHost[host] = (stats.byHost[host] || 0) + 1;
  const blocked = !local && mode === 'block';
  if (blocked) stats.blocked++;
  if (log) { try { appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), kind, host, path, blocked }) + '\n'); } catch { /* ignore */ } }
  return blocked;
}
const blockedError = (host) => Object.assign(new Error(`net-guard: outbound request to ${host} blocked`), { code: 'ENETGUARD' });

const realFetch = globalThis.fetch;
globalThis.fetch = async function guardedFetch(input, init) {
  const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, 'http://localhost');
  if (note('fetch', u.hostname, u.pathname)) throw blockedError(u.hostname);
  return realFetch(input, init);
};

function hostOf(args) {
  const a = args[0];
  if (typeof a === 'string') { try { const u = new URL(a); return [u.hostname, u.pathname]; } catch { return ['unknown', String(a)]; } }
  if (a instanceof URL) return [a.hostname, a.pathname];
  const o = a || {};
  return [String(o.hostname || o.host || 'localhost').replace(/:\d+$/, ''), String(o.path || '/')];
}
for (const [mod, name] of [[http, 'http'], [https, 'https']]) {
  for (const fn of ['request', 'get']) {
    const real = mod[fn];
    mod[fn] = function guarded(...args) {
      const [host, path] = hostOf(args);
      if (note(`${name}.${fn}`, host, path)) throw blockedError(host);
      return real.apply(this, args);
    };
  }
}
syncBuiltinESMExports();

process.on('exit', () => {
  process.stderr.write(`\n[net-guard] mode=${mode} attempts=${stats.attempts} blocked=${stats.blocked} local=${stats.allowedLocal} watched(${watch.join(',')})=${stats.watched} byHost=${JSON.stringify(stats.byHost)}\n`);
});
