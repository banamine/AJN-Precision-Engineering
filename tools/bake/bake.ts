/* `npx tsx tools/bake/bake.ts [--genre audio-otr,video-daily-highlights] [--root DIR] [--dry]`
 * Phase 1 bake: resolves Archive.org items ONCE and writes compact catalogs to src/data/baked/<version>/,
 * then validates them and flips src/data/baked/manifest.json to the new version in one atomic rename.
 * Nothing at runtime reads these files yet (Phase 2). Failure policy:
 *   missing   (404/dark/no mp3)  -> reported, item/channel omitted
 *   transient (5xx/429/network)  -> last known-good channel carried over (stale:true); no prior => NOTHING is published (exit 2)
 *   invalid / excluded           -> reported with reason */
import fs from 'node:fs';
import path from 'node:path';
import { archiveApiFetch } from '../../server/archiveLimiter';
import { dailyHighlightsContract, toChannels, HIGHLIGHTS_M3U_DIR } from '../../server/sources/dailyHighlights';
import { slug } from '../../server/sources/archiveLinks';
import { BAKED_DIR, SCHEMA_CATALOG, SCHEMA_MANIFEST, classify, fetchRetry, loadPrevious, readJson, writeCatalog, type Catalog, type CatalogChannel, type CatalogItem, type Manifest, type ManifestFile, type Unresolved } from './lib';
import { validate } from './validate';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const root = path.resolve(arg('--root') ?? process.cwd());
const genres = (arg('--genre') ?? 'audio-otr,video-daily-highlights').split(',');
const dry = process.argv.includes('--dry');
const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
const now = new Date().toISOString();

async function pool<T, R>(xs: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
  return out;
}
const seconds = (v: unknown) => { const s = String(v ?? ''); if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s)); const p = s.split(':').map(Number); return p.length > 1 && p.every((x) => !isNaN(x)) ? Math.round(p.reduce((a, b) => a * 60 + b, 0)) : 0; };

async function bakeAudioOtr(): Promise<Catalog> {
  const src = readJson<any[]>(path.join(root, 'src/data/archiveAudioChannels.json')) ?? [];
  const wanted = src.filter((c) => c.group === 'Old-Time Radio');
  const prev = loadPrevious(root, 'audio-otr.json');
  const cat: Catalog = { schema: SCHEMA_CATALOG, genre: 'audio-otr', items: {}, channels: [], unresolved: [] };
  await pool(wanted, 2, async (c) => {
    const fail = (klass: Unresolved['class'], reason: string) => {
      const old = prev?.channels.find((x) => x.id === c.id);
      if (klass === 'transient' && old) { cat.channels.push({ ...old, stale: true }); for (const id of old.itemIds) cat.items[id] = prev!.items[id]; cat.unresolved.push({ id: c.id, class: klass, reason: reason + ' (kept last known-good)' }); }
      else cat.unresolved.push({ id: c.id, class: klass, reason });
    };
    try {
      const r = await fetchRetry(`https://archive.org/metadata/${encodeURIComponent(c.itemId)}`, archiveApiFetch);
      if (!r.ok) return fail(classify(r.status), `metadata HTTP ${r.status}`);
      const meta: any = await r.json();
      if (meta?.is_dark || !Array.isArray(meta?.files)) return fail('missing', 'item dark/unavailable');
      const mp3 = meta.files.filter((f: any) => /\.mp3$/i.test(f.name) && String(f.private) !== 'true');
      const originals = mp3.filter((f: any) => f.source === 'original');
      const files = (originals.length ? originals : mp3).map((f: any) => ({ name: String(f.name), d: seconds(f.length), size: f.size ? Number(f.size) : undefined, format: f.format })).filter((f: any) => f.d > 0)
        .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!files.length) return fail('invalid', 'no MP3 with a known duration');
      const ch: CatalogChannel = { id: c.id, name: c.name, group: c.group, itemIds: [] };
      for (const f of files) {
        const id = `${c.itemId}/${f.name}`;
        const it: CatalogItem = { id, kind: 'audio', title: f.name.split('/').pop()!.replace(/\.mp3$/i, '').replace(/_+/g, ' ').trim() || c.itemId, path: `/download/${encodeURIComponent(c.itemId)}/${enc(f.name)}`, durationSeconds: f.d, size: f.size, format: f.format };
        cat.items[id] = it; ch.itemIds.push(id);
      }
      cat.channels.push(ch);
    } catch (e: any) { fail('transient', String(e?.message ?? e)); }
  });
  cat.channels.sort((a, b) => a.id.localeCompare(b.id));
  return cat;
}

async function bakeDailyHighlights(): Promise<Catalog> {
  const prev = loadPrevious(root, 'video-daily-highlights.json');
  const cat: Catalog = { schema: SCHEMA_CATALOG, genre: 'video-daily-highlights', items: {}, channels: [], unresolved: [] };
  const f2: typeof fetch = (u: any, i?: any) => fetchRetry(String(u), archiveApiFetch, 4);
  const res = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: f2 }, { now: new Date(), signal: new AbortController().signal } as any);
  const transientChannels = new Set<string>();
  for (const r of res.rejected ?? []) {
    const m = r.reason.match(/^playlist (HTTP (\d+)|.*)$/);
    if (m) {
      const klass = m[2] ? classify(+m[2]) : 'transient';
      cat.unresolved.push({ id: r.id, class: klass, reason: r.reason });
      if (klass === 'transient') transientChannels.add(`classic-${slug(r.id.slice(HIGHLIGHTS_M3U_DIR.length).replace(/\.m3u8?$/i, '').trim())}`);
    } else cat.unresolved.push({ id: r.id, class: r.reason === 'excluded playlist' || /audio-only|not web|not browser-playable|no media file|unsupported|archive member|compressed/i.test(r.reason) ? 'excluded' : 'invalid', reason: r.reason });
  }
  if (res.status === 'upstream_error' || res.status === 'offline') { cat.unresolved.push({ id: 'daily-highlights', class: 'transient', reason: res.error ?? res.status }); }
  for (const ch of toChannels(res.programs)) {
    const c: CatalogChannel = { id: ch.id, name: ch.name, group: 'Classic TV', itemIds: [] };
    for (const p of ch.programs) {
      const md: any = p.metadata ?? {};
      cat.items[p.id] = { id: p.id, kind: 'video', title: p.title, path: (p as any).archivePath ?? p.mediaUrl, durationSeconds: md.durationSeconds, show: md.show, season: md.season, episode: md.episode };
      c.itemIds.push(p.id);
    }
    cat.channels.push(c);
  }
  for (const id of transientChannels) {   // carry the last known-good channel over for playlists that failed transiently
    if (cat.channels.some((c) => c.id === id)) continue;
    const old = prev?.channels.find((c) => c.id === id);
    if (old) { cat.channels.push({ ...old, stale: true }); for (const i of old.itemIds) cat.items[i] = prev!.items[i]; }
  }
  cat.channels.sort((a, b) => a.id.localeCompare(b.id));
  return cat;
}

(async () => {
  const baked: Record<string, Catalog> = {};
  if (genres.includes('audio-otr')) baked['audio-otr.json'] = await bakeAudioOtr();
  if (genres.includes('video-daily-highlights')) baked['video-daily-highlights.json'] = await bakeDailyHighlights();
  // Publish gate: an unresolved transient failure with no last-known-good means the catalog would silently lose content.
  const lost = Object.entries(baked).flatMap(([f, c]) => c.unresolved.filter((u) => u.class === 'transient' && !/last known-good/.test(u.reason) && !c.channels.some((ch) => ch.id === u.id || (ch.stale && u.id.includes(ch.name)))).map((u) => `${f}: ${u.id}: ${u.reason}`));
  const report = Object.fromEntries(Object.entries(baked).map(([f, c]) => [f, { items: Object.keys(c.items).length, channels: c.channels.length, stale: c.channels.filter((x) => x.stale).length, unresolved: c.unresolved.reduce((a: any, u) => (a[u.class] = (a[u.class] ?? 0) + 1, a), {}) }]));
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/bake-report.json'), JSON.stringify({ bakedAt: now, genres, report, unresolved: Object.fromEntries(Object.entries(baked).map(([f, c]) => [f, c.unresolved])), lostTransient: lost }, null, 1));
  console.log(JSON.stringify(report, null, 1));
  if (lost.length) { console.error(`NOT PUBLISHED: ${lost.length} transient failure(s) without a last-known-good:\n` + lost.slice(0, 20).join('\n')); process.exit(2); }
  if (dry) { console.log('dry run: nothing written'); return; }

  const bakedRoot = path.join(root, BAKED_DIR);
  const version = 'v' + now.replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const tmp = path.join(bakedRoot, `.tmp-${version}`), final = path.join(bakedRoot, version);
  fs.mkdirSync(tmp, { recursive: true });
  const prevM = readJson<Manifest>(path.join(bakedRoot, 'manifest.json'));
  const files: Record<string, ManifestFile> = {};
  for (const [f, c] of Object.entries(baked)) files[f] = writeCatalog(tmp, f, c);
  if (prevM) for (const [f, meta] of Object.entries(prevM.files)) if (!files[f]) { fs.copyFileSync(path.join(bakedRoot, prevM.dir, f), path.join(tmp, f)); files[f] = meta; }
  const manifest: Manifest = { schema: SCHEMA_MANIFEST, version, generatedAt: now, dir: version, files };
  fs.renameSync(tmp, final);
  // Validate the candidate (against a staged manifest) before it becomes current; on failure remove it and keep the old version.
  const cur = path.join(bakedRoot, 'manifest.json'), next = path.join(bakedRoot, 'manifest.next.json');
  fs.writeFileSync(next, JSON.stringify(manifest, null, 1));
  const had = fs.existsSync(cur) ? fs.readFileSync(cur) : null;
  fs.renameSync(next, cur);                                   // atomic flip (same dir)
  const errs = validate(root);
  if (errs.length) { if (had) fs.writeFileSync(cur, had); else fs.unlinkSync(cur); fs.rmSync(final, { recursive: true, force: true }); console.error('VALIDATION FAILED, previous version kept:\n' + errs.join('\n')); process.exit(3); }
  // Keep the new and one previous version for rollback; drop older ones.
  const dirs = fs.readdirSync(bakedRoot).filter((d) => /^v\d{8}-\d{6}$/.test(d)).sort();
  for (const d of dirs.slice(0, -2)) fs.rmSync(path.join(bakedRoot, d), { recursive: true, force: true });
  console.log(`published ${version}`);
})().catch((e) => { console.error('bake failed:', e); process.exit(1); });
