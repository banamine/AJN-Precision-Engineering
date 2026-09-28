/* Build the packaged Library index (src/data/libraryIndex.json) on a PC.
 *   npm run library:snapshot                 # all search categories
 *   npm run library:snapshot -- --allow-shrink
 *   npm run library:snapshot -- --only cartoons,audiobooks
 * Searches each collection category (top ITEMS_PER_SEARCH by downloads), reads
 * each item's metadata once through the shared Archive limiter, picks the
 * playable file with the shared selector, and writes compact JSON.
 * Refuses to replace a snapshot with one under 80% of its size unless
 * --allow-shrink (a bad network day must not wipe the Library). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LIBRARY_CATEGORIES, ITEMS_PER_SEARCH, searchUrl, recordFromMetadata, mergeRecords, type IndexRecord, type LibrarySnapshot } from '../server/libraryIndex';
import { archiveApiFetch } from '../server/archiveLimiter';

const OUT = path.join(process.cwd(), 'src', 'data', 'libraryIndex.json');
const allowShrink = process.argv.includes('--allow-shrink');
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

// AJN_FETCH=curl: use curl.exe instead of Node fetch (for machines where Node's
// fetch is blocked by a proxy but curl works). Normal PCs don't need it.
const curlFetch = (async (url: string) => {
  const body = execFileSync('curl', ['-s', '-L', '--max-time', '60', '-w', '\n%{http_code}', url], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const i = body.lastIndexOf('\n');
  return new Response(body.slice(0, i), { status: Number(body.slice(i + 1)) || 599 });
}) as unknown as typeof fetch;
const f: typeof fetch = process.env.AJN_FETCH === 'curl' ? curlFetch : archiveApiFetch;

async function json(url: string, tries = 3): Promise<any | null> {
  for (let t = 1; t <= tries; t++) {
    try { const r = await f(url); if (r.ok) return await r.json(); if (r.status < 500 && r.status !== 429) return null; } catch { /* retry */ }
    await new Promise((ok) => setTimeout(ok, 1500 * t));
  }
  return null;
}

async function main() {
  const t0 = Date.now();
  const previous: LibrarySnapshot | null = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const keep = only && previous ? previous.items.filter((r) => !r.categoryIds.some((c) => only.has(c))) : [];
  const records: IndexRecord[] = [...keep];
  const stats: Record<string, { found: number; kept: number; unsupported: number; noMeta: number; estimated: number }> = {};
  for (const c of LIBRARY_CATEGORIES.filter((c) => c.query && (!only || only.has(c.id)))) {
    const s = (stats[c.id] = { found: 0, kept: 0, unsupported: 0, noMeta: 0, estimated: 0 });
    const res = await json(searchUrl(c));
    const docs: any[] = res?.response?.docs ?? [];
    s.found = docs.length;
    process.stdout.write(`${c.label.padEnd(26)} ${String(docs.length).padStart(3)} found `);
    let n = 0;
    for (const d of docs) {
      if (typeof d?.identifier !== 'string') continue;
      const meta = await json(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`);
      if (!meta || meta.is_dark) { s.noMeta++; continue; }
      const r = recordFromMetadata(c, d, meta);
      if (r.availability === 'unsupported') { s.unsupported++; continue; }
      if (r.durEst) s.estimated++;
      records.push(r); s.kept++;
      if (++n % 25 === 0) process.stdout.write('.');
    }
    console.log(` kept ${s.kept}, no web file ${s.unsupported}, no metadata ${s.noMeta}, estimated durations ${s.estimated}`);
  }
  const items = mergeRecords(records).sort((a, b) => a.id.localeCompare(b.id));
  if (previous && items.length < previous.items.length * 0.8 && !allowShrink) {
    console.error(`\nREFUSED: new index has ${items.length} items, previous has ${previous.items.length}. Nothing written. Re-run with --allow-shrink if this is intended.`);
    process.exit(1);
  }
  const snap: LibrarySnapshot = { schemaVersion: 1, generatedAt: new Date().toISOString(), items };
  fs.writeFileSync(OUT, JSON.stringify(snap));
  console.log(`\nWrote ${items.length} items (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) to ${OUT} in ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
