/* `npx tsx tools/bake/check-urls.ts [--sample N] [--seed S] [--root DIR]` — NETWORK. Health report only; never edits catalogs.
 * Per unique URL: availability (a bytes=0-1 range GET resolves to a media response) and range support (206 vs 200) are recorded SEPARATELY.
 * Deduplicated, concurrency-bounded, body capped at 2 bytes read, results cached in reports/url-health.cache.json (24 h). */
import fs from 'node:fs';
import path from 'node:path';
import { BAKED_DIR, readJson, type Catalog, type Manifest } from './lib';
import { resolveArchiveMediaRedirect } from '../../server/archiveFetch';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', process.cwd())!); const N = +(arg('--sample', '0')!); const seed = +(arg('--seed', '1')!);
const cachePath = path.join(root, 'reports/url-health.cache.json');
type H = { at: number; available: boolean; rangeSupport: boolean | null; status: number; contentType?: string; note?: string };
const cache: Record<string, H> = readJson(cachePath) ?? {};
const rnd = (() => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

async function probe(url: string): Promise<H> {
  const at = Date.now();
  try {
    const r = await resolveArchiveMediaRedirect(url, { timeoutMs: 20000 });   // validated redirect chain, 1-byte range probe
    if (!r.url) return { at, available: false, rangeSupport: null, status: r.status };
    const res = await fetch(r.url, { headers: { Range: 'bytes=0-1' }, redirect: 'manual' });
    const reader = res.body?.getReader(); if (reader) { await reader.read().catch(() => {}); await reader.cancel().catch(() => {}); }
    const ct = res.headers.get('content-type') ?? '';
    const ok = res.status === 206 || res.status === 200;
    return { at, available: ok && !/text\/html/i.test(ct), rangeSupport: ok ? res.status === 206 : null, status: res.status, contentType: ct };
  } catch (e: any) { return { at, available: false, rangeSupport: null, status: 0, note: String(e?.message ?? e).slice(0, 80) }; }
}

(async () => {
  const m = readJson<Manifest>(path.join(root, BAKED_DIR, 'manifest.json'))!;
  const urls = new Map<string, string[]>();
  for (const f of Object.keys(m.files)) {
    const c = readJson<Catalog>(path.join(root, BAKED_DIR, m.dir, f))!;
    for (const it of Object.values(c.items)) if (it.path.startsWith('/download/')) { const u = 'https://archive.org' + it.path; (urls.get(u) ?? urls.set(u, []).get(u)!).push(`${f}:${it.id}`); }
  }
  let list = [...urls.keys()].sort();
  const total = list.length;
  if (N) list = list.map((u) => [rnd(), u] as const).sort((a, b) => a[0] - b[0]).slice(0, N).map((x) => x[1]);
  const todo = list.filter((u) => !cache[u] || Date.now() - cache[u].at > 864e5);
  let i = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (i < todo.length) { const u = todo[i++]; cache[u] = await probe(u); } }));
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  const rows = list.map((u) => ({ u, ...cache[u] }));
  const sum = { unique: total, checked: rows.length, available: rows.filter((r) => r.available).length, unavailable: rows.filter((r) => !r.available).length, availableNoRange: rows.filter((r) => r.available && r.rangeSupport === false).length };
  console.log(JSON.stringify(sum));
  for (const r of rows.filter((r) => !r.available || r.rangeSupport === false).slice(0, 25)) console.log(r.available ? 'NO-RANGE' : 'DOWN', r.status, r.u, r.note ?? '');
  fs.writeFileSync(path.join(root, 'reports/url-health.json'), JSON.stringify({ checkedAt: new Date().toISOString(), sum, bad: rows.filter((r) => !r.available || r.rangeSupport === false) }, null, 1));
})();
