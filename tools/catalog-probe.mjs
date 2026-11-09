#!/usr/bin/env node
// Playability probe for a catalog refresh: every NEW row (vs the base ref) gets a real 1 KB Range request
// against archive.org. Rows that do not answer 200/206 with media are REMOVED from the data files before
// the gate runs, so nothing that fails to load can reach the guide. New channels left empty are dropped.
// Usage: node tools/catalog-probe.mjs --base origin/main --out catalog-probe.json [--max 4000] [--interval 1550]
//        [--budget-minutes 140] [--cache .catalog-probe-cache/probe-results.json]
// Resumable: results are kept in a small JSON cache, so rows verified (or definitively failed) in an earlier run are not
// requested again. When the time budget is used up the probe stops cleanly (exit 0), writes its result with the remaining
// rows counted as `unprobed` (the gate sends those to review) and the next run continues where this one stopped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitJson } from './catalog-gate.mjs';

const UA = 'AJN-Precision-Engineering catalog playability probe/1.0';
const rowKey = (row) => `${row.identifier}/${row.file ?? row.id ?? ''}`;
const docKey = (e) => `${e.id}|${e.u}`;

export function rowUrl(row) {
  return `https://archive.org/download/${encodeURIComponent(row.identifier)}/${String(row.file).split('/').map(encodeURIComponent).join('/')}`;
}

/** Pure: the rows and documentary entries in head that are not in base. */
export function newTargets(base, head) {
  const baseRows = new Set((base.extra?.channels ?? []).flatMap((c) => (c.rows ?? []).map(rowKey)));
  const baseDocs = new Set((base.docs ?? []).map(docKey));
  const targets = [];
  for (const c of head.extra?.channels ?? []) {
    for (const r of c.rows ?? []) if (!baseRows.has(rowKey(r))) targets.push({ kind: 'row', channelId: c.id, key: rowKey(r), url: rowUrl(r) });
  }
  for (const e of head.docs ?? []) if (!baseDocs.has(docKey(e))) targets.push({ kind: 'doc', channelId: e.g, key: docKey(e), url: e.u });
  return targets;
}

const MEDIA_TYPE = /^(video\/|audio\/|application\/(octet-stream|mp4|ogg|x-matroska)|binary\/octet-stream)/;

/** Pure: is this response a playable media answer? Needs 200/206, a media content type and at least 1 body byte. */
export function judge(status, contentType, bodyBytes) {
  if (status !== 200 && status !== 206) return { ok: false, reason: `HTTP ${status}` };
  const type = String(contentType ?? '').toLowerCase().trim();
  if (!MEDIA_TYPE.test(type)) return { ok: false, reason: `not media (${type || 'no content-type'})` };
  if (!(bodyBytes > 0)) return { ok: false, reason: 'empty body' };
  return { ok: true };
}

/** Pure: drop failed rows/entries from head; drop channels that were new and are now empty. */
export function applyFailures(base, head, failedKeys) {
  const baseIds = new Set((base.extra?.channels ?? []).map((c) => c.id));
  const failed = new Set(failedKeys);
  const channels = [];
  const droppedChannels = [];
  for (const c of head.extra?.channels ?? []) {
    const rows = (c.rows ?? []).filter((r) => !failed.has(rowKey(r)));
    if (!rows.length && !baseIds.has(c.id)) { droppedChannels.push(c.id); continue; }
    channels.push(rows.length === (c.rows ?? []).length ? c : { ...c, rows });
  }
  return {
    extra: head.extra ? { ...head.extra, channels } : head.extra,
    docs: (head.docs ?? []).filter((e) => !failed.has(docKey(e))),
    droppedChannels,
  };
}

async function readUpTo(res, limit) {
  if (!res.body) return 0;
  const reader = res.body.getReader();
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
  return total;
}

/** One target: redirects are followed by hand so every hop is paced and counted. */
async function probeOne(url, { fetchImpl, timeoutMs, pace, ledger }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let target = url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        await pace();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
          res = await fetchImpl(target, { headers: { Range: 'bytes=0-1023', 'User-Agent': UA }, redirect: 'manual', signal: controller.signal });
          ledger.push({ url: target, status: res.status, hop, attempt });
          const location = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && location) {
            try { await res.body?.cancel(); } catch { /* not needed */ }
            target = new URL(location, target).href;
            continue;
          }
          if (res.status === 429 || res.status === 503) { try { await res.body?.cancel(); } catch { /* not needed */ } return { stop: true, status: res.status }; }
          if (res.status >= 500 && attempt === 1) { try { await res.body?.cancel(); } catch { /* not needed */ } break; }
          const bytes = res.status === 200 || res.status === 206 ? await readUpTo(res, 1024) : 0;
          if (!bytes) { try { await res.body?.cancel(); } catch { /* not needed */ } }
          return { status: res.status, ...judge(res.status, res.headers.get('content-type'), bytes) };
        } finally {
          clearTimeout(timer);
        }
      }
      if (attempt === 2) return { ok: false, status: 0, reason: 'too many redirects or server error' };
    } catch (error) {
      ledger.push({ url: target, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error), attempt });
      if (attempt === 2) return { ok: false, status: 0, reason: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) };
    }
  }
  return { ok: false, status: 0, reason: 'unreachable' };
}

const DAY_MS = 86_400_000;

/** Pure: keep only cache entries that are still fresh (ok results 30 days, definitive failures 7 days). */
export function freshCache(raw, now, { okTtlDays = 30, failTtlDays = 7 } = {}) {
  const out = new Map();
  for (const [key, e] of Object.entries(raw?.entries ?? {})) {
    if (!e || typeof e.t !== 'number') continue;
    const ttl = (e.ok ? okTtlDays : failTtlDays) * DAY_MS;
    if (now - e.t <= ttl) out.set(key, e);
  }
  return out;
}

export function readProbeCache(path, now = Date.now()) {
  if (!path || !existsSync(path)) return new Map();
  try { return freshCache(JSON.parse(readFileSync(path, 'utf8')), now); } catch { return new Map(); }
}

export function writeProbeCache(path, cache) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: 'ajn.catalogProbeCache.v1', entries: Object.fromEntries(cache) }));
}

export async function probe(targets, {
  fetchImpl = fetch, intervalMs = 1550, timeoutMs = 30000, max = 4000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  cache = new Map(), budgetMs = Infinity, now = () => Date.now(), progressEvery = 100, log = () => {}, onProgress = () => {},
} = {}) {
  const failed = [];
  const ledger = [];
  let ok = 0;
  let cached = 0;
  let stoppedAt = null;
  let budgetStop = null;
  const startedAt = now();
  let started = false;
  // Every request (including redirect hops and retries) waits intervalMs after the previous one.
  const pace = async () => { if (started) await sleep(intervalMs); started = true; };
  const limit = Math.min(targets.length, max);
  let stopIndex = limit;
  for (let i = 0; i < limit; i++) {
    const hit = cache.get(targets[i].key);
    if (hit) {
      cached++;
      if (hit.ok) ok++; else failed.push({ ...targets[i], status: hit.status, reason: `${hit.reason} (cached)` });
      continue;
    }
    if (now() - startedAt >= budgetMs) { budgetStop = { index: i, minutes: Math.round((now() - startedAt) / 60000) }; stopIndex = i; break; }
    const result = await probeOne(targets[i].url, { fetchImpl, timeoutMs, pace, ledger });
    if (result.stop) { stoppedAt = { index: i, status: result.status }; stopIndex = i; break; }
    if (result.ok) ok++; else failed.push({ ...targets[i], status: result.status, reason: result.reason });
    // Only definitive answers are remembered; timeouts and network errors are retried next run.
    if (result.ok || result.status > 0) cache.set(targets[i].key, { ok: !!result.ok, status: result.status ?? 0, reason: result.reason ?? null, t: now() });
    if (progressEvery && (i + 1) % progressEvery === 0) {
      log(`[probe] ${i + 1}/${limit} · ok ${ok} · failed ${failed.length} · cached ${cached} · requests ${ledger.length}`);
      onProgress();
    }
  }
  const probed = stopIndex;
  return { targets: targets.length, probed, ok, failed, unprobed: targets.length - probed, stoppedAt, budgetStop, cached, requests: ledger.length, ledger };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = args(process.argv.slice(2));
  const config = JSON.parse(readFileSync(a.config ?? 'config/catalog-refresh.json', 'utf8'));
  const files = config.dataFiles;
  const ref = a.base ?? 'origin/main';
  const base = { extra: gitJson(ref, files.extra), docs: gitJson(ref, files.docs) };
  const head = { extra: JSON.parse(readFileSync(files.extra, 'utf8')), docs: JSON.parse(readFileSync(files.docs, 'utf8')) };
  const targets = newTargets(base, head);
  console.log(`[probe] ${targets.length} new rows/entries to check`);
  const cache = readProbeCache(a.cache);
  if (a.cache) console.log(`[probe] cache ${a.cache}: ${cache.size} fresh entries`);
  let result;
  try {
    result = await probe(targets, {
      max: Number(a.max ?? 4000), intervalMs: Number(a.interval ?? 1550),
      budgetMs: Number(a['budget-minutes'] ?? 140) * 60_000, cache, log: console.log, onProgress: () => writeProbeCache(a.cache, cache),
    });
  } finally {
    writeProbeCache(a.cache, cache);
  }
  if (result.failed.length) {
    const next = applyFailures(base, head, result.failed.map((f) => f.key));
    writeFileSync(files.extra, JSON.stringify(next.extra));
    writeFileSync(files.docs, JSON.stringify(next.docs));
    result.droppedChannels = next.droppedChannels;
  }
  if (a.out) writeFileSync(a.out, JSON.stringify(result, null, 1));
  console.log(`[probe] ok ${result.ok} · failed ${result.failed.length} · unprobed ${result.unprobed} · cached ${result.cached}${result.stoppedAt ? ` (stopped: HTTP ${result.stoppedAt.status})` : ''}${result.budgetStop ? ` (time budget reached after ${result.budgetStop.minutes} min; next run continues)` : ''}`);
}
