#!/usr/bin/env node
// Playability probe for a catalog refresh: every NEW row (vs the base ref) gets a real 1 KB Range request
// against archive.org. Rows that do not answer 200/206 with media are REMOVED from the data files before
// the gate runs, so nothing that fails to load can reach the guide. New channels left empty are dropped.
// Usage: node tools/catalog-probe.mjs --base origin/main --out catalog-probe.json [--max 4000] [--interval 1550]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
      for (const r of c.rows ?? []) if (!baseRows.has(rowKey(r))) targets.push({
        kind: 'row', channelId: c.id, key: rowKey(r), url: rowUrl(r),
        identifier: r.identifier, file: r.file, size: r.bytes ?? r.size ?? null, mtime: r.mtime ?? null,
      });
  }
  for (const e of head.docs ?? []) if (!baseDocs.has(docKey(e))) targets.push({ kind: 'doc', channelId: e.g, key: docKey(e), url: e.u });
  return targets;
}

const MEDIA_TYPE = /^(video\/|audio\/|application\/(octet-stream|mp4|ogg|x-matroska)|binary\/octet-stream)/;

/** Pure: is this response a playable media answer? Needs 200/206, a media content type and at least 1 body byte. */
export function judge(status, contentType, bodyBytes) {
  if (status === 403) return { ok: false, definitive: true, reason: 'restricted (HTTP 403)' };
  if (status === 404 || status === 410) return { ok: false, definitive: true, reason: `HTTP ${status}` };
  if (status !== 200 && status !== 206) return { ok: false, inconclusive: true, reason: `HTTP ${status}` };
  const type = String(contentType ?? '').toLowerCase().trim();
  if (!MEDIA_TYPE.test(type)) return { ok: false, definitive: true, reason: `not media (${type || 'no content-type'})` };
  if (!(bodyBytes > 0)) return { ok: false, definitive: true, reason: 'empty body' };
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

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_FILE = 'playability-probe-cache.json';
const hostFor = (url) => {
  try { return new URL(url).host.toLowerCase(); } catch { return 'invalid-url'; }
};

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.ceil(seconds * 1000))) : null;
  }
  const dateMs = Date.parse(text);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

function cancelBody(response) {
  return response.body?.cancel().catch(() => {}) ?? Promise.resolve();
}

async function readUpTo(response, limit) {
  if (!response.body) return 0;
  const reader = response.body.getReader();
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

function createHostScheduler({ maxPerHost, intervalMs, now, sleep }) {
  const states = new Map();
  const stateFor = (host) => {
    if (!states.has(host)) states.set(host, { active: 0, lastStart: -Infinity, cooldownUntil: 0, waiting: false, queue: [] });
    return states.get(host);
  };
  const pump = (host, state) => {
    if (state.waiting || state.active >= maxPerHost || !state.queue.length) return;
    const entry = state.queue[0];
    const deadlineWaitMs = entry.deadlineAt - now();
    if (deadlineWaitMs <= 0) {
      state.queue.shift();
      entry.resolve({ unprobed: true });
      pump(host, state);
      return;
    }
    const requiredWaitMs = Math.max(0, state.lastStart + intervalMs - now(), state.cooldownUntil - now());
    const waitMs = Math.min(requiredWaitMs, deadlineWaitMs);
    if (waitMs > 0) {
      state.waiting = true;
      Promise.resolve(sleep(waitMs)).then(() => {
        state.waiting = false;
        pump(host, state);
      }, (error) => {
        state.waiting = false;
        for (const entry of state.queue.splice(0)) entry.reject(error);
      });
      return;
    }
    state.queue.shift();
    state.active++;
    state.lastStart = now();
    Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
      state.active--;
      pump(host, state);
    });
    pump(host, state);
  };
  return {
    run(url, task, deadlineAt) {
      const host = hostFor(url);
      const state = stateFor(host);
      return new Promise((resolve, reject) => {
        state.queue.push({ task, resolve, reject, deadlineAt });
        pump(host, state);
      });
    },
    noteRetryAfter(url, header) {
      const host = hostFor(url);
      const delay = parseRetryAfter(header, now());
      if (delay !== null) {
        const state = stateFor(host);
        state.cooldownUntil = Math.max(state.cooldownUntil, now() + delay);
      }
    },
  };
}

function metadataFile(target, cacheDir) {
  let identifier = target.identifier;
  let file = target.file;
  if ((!identifier || !file) && target.kind === 'doc') {
    try {
      const url = new URL(target.url);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'download' && parts.length >= 3) {
        identifier = decodeURIComponent(parts[1]);
        file = parts.slice(2).map(decodeURIComponent).join('/');
      }
    } catch { return null; }
  }
  if (!identifier || !file || !cacheDir) return null;
  const hash = createHash('md5').update(identifier).digest('hex').slice(0, 16);
  const path = join(cacheDir, 'meta', `${hash}.json`);
  try {
    const metadata = JSON.parse(readFileSync(path, 'utf8'));
    const match = (metadata.files ?? []).find((entry) => entry.name === file);
    if (!match || match.mtime === undefined || match.mtime === null) return null;
    return {
      identifier,
      file,
      size: match.size ?? target.size ?? target.bytes ?? null,
      mtime: match.mtime,
    };
  } catch { return null; }
}

function cacheDescriptor(target, cacheDir) {
  const metadata = metadataFile(target, cacheDir);
  if (!metadata || metadata.size === null || metadata.size === undefined) return null;
  return { ...metadata, key: JSON.stringify([metadata.identifier, metadata.file, metadata.size, metadata.mtime]) };
}

function readProbeCache(cacheDir) {
  if (!cacheDir) return { entries: {}, path: null };
  const path = join(cacheDir, CACHE_FILE);
  if (!existsSync(path)) return { entries: {}, path };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.schema !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    throw new Error(`Invalid playability probe cache: ${path}`);
  }
  return { entries: parsed.entries, path };
}

function cacheableResult(result) {
  return result?.ok === true || (result?.ok === false && result?.definitive === true);
}

function writeProbeCache(cache, nowMs) {
  if (!cache.path) return;
  const entries = Object.fromEntries(Object.entries(cache.entries).filter(([, value]) =>
    cacheableResult(value.result) &&
    Number.isFinite(value.cachedAt) && nowMs - value.cachedAt >= 0 && nowMs - value.cachedAt <= CACHE_TTL_MS));
  mkdirSync(dirname(cache.path), { recursive: true });
  writeFileSync(cache.path, JSON.stringify({ schema: 1, entries }, null, 1));
}

/** One target; every physical redirect hop is separately host-limited and logged. */
async function probeOne(target, { fetchImpl, timeoutMs, scheduler, ledger, now, deadlineAt }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let currentUrl = target.url;
    let retry = false;
    for (let hop = 0; hop < 6; hop++) {
      const outcome = await scheduler.run(currentUrl, async () => {
        if (now() >= deadlineAt) return { unprobed: true };
        const host = hostFor(currentUrl);
        const log = { url: currentUrl, host, startedAt: now(), hop, attempt };
        ledger.push(log);
        const controller = new AbortController();
        let timer;
        try {
          const response = await new Promise((resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              const error = new Error(`header timeout after ${timeoutMs} ms`);
              error.name = 'AbortError';
              reject(error);
            }, timeoutMs);
            Promise.resolve(fetchImpl(currentUrl, {
              headers: { Range: 'bytes=0-1023', 'User-Agent': UA },
              redirect: 'manual',
              signal: controller.signal,
            })).then(resolve, reject);
          });
          clearTimeout(timer);
          log.status = response.status;
          const location = response.headers.get('location');
          if (response.status >= 300 && response.status < 400 && location) {
            await cancelBody(response);
            return { redirect: new URL(location, currentUrl).href };
          }
          if (response.status === 429) {
            scheduler.noteRetryAfter(currentUrl, response.headers.get('retry-after'));
            await cancelBody(response);
            return { status: response.status, ok: false, inconclusive: true, reason: 'HTTP 429' };
          }
          if (response.status >= 500 && response.status <= 599) {
            scheduler.noteRetryAfter(currentUrl, response.headers.get('retry-after'));
            await cancelBody(response);
            return attempt === 1
              ? { status: response.status, retryable: true }
              : { status: response.status, ok: false, inconclusive: true, reason: `HTTP ${response.status}` };
          }
          const bodyBytes = response.status === 200 || response.status === 206 ? await readUpTo(response, 1024) : 0;
          if (!bodyBytes) await cancelBody(response);
          return { status: response.status, ...judge(response.status, response.headers.get('content-type'), bodyBytes) };
        } catch (error) {
          const timedOut = controller.signal.aborted || error?.name === 'AbortError';
          log.error = timedOut ? 'timeout' : String(error?.message ?? error);
          return {
            status: 0,
            ok: false,
            reason: timedOut ? 'timeout' : String(error?.message ?? error),
            retryable: attempt === 1,
            inconclusive: attempt > 1,
          };
        } finally {
          clearTimeout(timer);
        }
      }, deadlineAt);
      if (outcome.unprobed) return outcome;
      if (outcome.redirect) { currentUrl = outcome.redirect; continue; }
      if (outcome.retryable && attempt === 1) { retry = true; break; }
      return outcome;
    }
    if (!retry) return { status: 0, ok: false, inconclusive: true, reason: 'too many redirects' };
  }
  return { status: 0, ok: false, inconclusive: true, reason: 'unreachable' };
}

export async function probe(targets, {
  fetchImpl = fetch,
  maxWorkers = 4,
  maxPerHost = 2,
  intervalMs = 750,
  timeoutMs = 20_000,
  deadlineMs = 110 * 60 * 1000,
  max = 4000,
  cacheDir = null,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = null,
} = {}) {
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new RangeError('maxWorkers must be a positive integer');
  if (!Number.isInteger(maxPerHost) || maxPerHost < 1) throw new RangeError('maxPerHost must be a positive integer');
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new RangeError('intervalMs must be non-negative');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new RangeError('deadlineMs must be non-negative');
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;
  const limit = Math.min(targets.length, max);
  const cache = readProbeCache(cacheDir);
  const scheduler = createHostScheduler({ maxPerHost, intervalMs, now, sleep });
  const ledger = [];
  const failed = [];
  const inconclusive = [];
  let cursor = 0;
  let probed = 0;
  let ok = 0;
  let cacheHits = 0;
  let deadlineHit = false;
  const reportProgress = () => {
    if (!onProgress || probed === 0 || probed % 50 !== 0) return;
    const elapsedMs = Math.max(0, now() - startedAt);
    const rowsPerMinute = elapsedMs > 0 ? Math.round((probed * 60_000) / elapsedMs) : 0;
    onProgress({ probed, total: targets.length, ok, failed: failed.length, inconclusive: inconclusive.length, elapsedMs, rowsPerMinute });
  };
  const worker = async () => {
    while (true) {
      if (now() >= deadlineAt) { deadlineHit = true; return; }
      const index = cursor++;
      if (index >= limit) return;
      const target = targets[index];
      const descriptor = cacheDescriptor(target, cacheDir);
      const cached = descriptor ? cache.entries[descriptor.key] : null;
      const cacheAge = cached ? now() - cached.cachedAt : Infinity;
      let result;
      if (cached && cacheableResult(cached.result) && Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge <= CACHE_TTL_MS) {
        result = { ...cached.result, cached: true };
        cacheHits++;
      } else {
        result = await probeOne(target, { fetchImpl, timeoutMs, scheduler, ledger, now, deadlineAt });
        if (result.unprobed) { deadlineHit = true; return; }
        if (descriptor && cacheableResult(result)) cache.entries[descriptor.key] = {
          cachedAt: now(),
          result: { status: result.status, ok: result.ok, definitive: result.definitive === true, reason: result.reason ?? null },
        };
      }
      probed++;
      if (result.ok) ok++;
      else if (result.definitive === true) failed.push({ ...target, status: result.status, reason: result.reason });
      else inconclusive.push({ ...target, status: result.status, reason: result.reason });
      reportProgress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxWorkers, limit) }, () => worker()));
  writeProbeCache(cache, now());
  return {
    targets: targets.length,
    probed,
    ok,
    failed,
    inconclusive,
    unprobed: targets.length - probed,
    deadlineHit,
    cacheHits,
    requests: ledger.length,
    ledger,
  };
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
  const result = await probe(targets, {
    max: Number(a.max ?? 4000),
    maxWorkers: Number(a.workers ?? 4),
    maxPerHost: Number(a.perHost ?? 2),
    intervalMs: Number(a.interval ?? 750),
    timeoutMs: Number(a.timeout ?? 20_000),
    deadlineMs: Number(a.deadlineMinutes ?? 110) * 60_000,
    cacheDir: a.cacheDir ?? '.catalog-cache',
    fetchImpl: a.offline === 'true' ? async () => { throw new Error('offline mode blocked fetch'); } : fetch,
    onProgress: (p) => console.log(`[probe] ${p.probed}/${p.total} · ok ${p.ok} · failed ${p.failed} · inconclusive ${p.inconclusive} · elapsed ${Math.round(p.elapsedMs / 1000)}s · ${p.rowsPerMinute} rows/min`),
  });
  if (result.failed.length) {
    const next = applyFailures(base, head, result.failed.map((f) => f.key));
    writeFileSync(files.extra, JSON.stringify(next.extra));
    writeFileSync(files.docs, JSON.stringify(next.docs));
    result.droppedChannels = next.droppedChannels;
  }
  if (a.out) writeFileSync(a.out, JSON.stringify(result, null, 1));
  console.log(`[probe] ok ${result.ok} · failed ${result.failed.length} · inconclusive ${result.inconclusive.length} · cached ${result.cacheHits} · unprobed ${result.unprobed}${result.deadlineHit ? ' (deadline reached)' : ''}`);
}
