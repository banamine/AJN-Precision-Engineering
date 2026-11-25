/* Master list of real sentences from old-print OCR scans (18th-century tracts etc.), so Archive.org is scanned once per item.
 * Usage:  npx tsx scripts/build-oldprint-index.ts --ids ids.txt [--out public/desk/oldprint.json] [--per-item 20]
 *         npx tsx scripts/build-oldprint-index.ts --file path/to/x_hocr_searchtext.txt.gz --id some-identifier   (offline)
 * ids.txt: one Archive.org identifier per line. Reads https://archive.org/download/<id>/<id>_hocr_searchtext.txt.gz.
 * An item is re-read only when it is new or NORMALIZER_VERSION changed. Needs internet only for --ids. */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NORMALIZER_VERSION, findSentences, type FoundSentence } from '../server/ocrNormalize';

export interface OldPrintItem { identifier: string; normalizerVersion: number; scannedAt: string; sentences: FoundSentence[] }
export interface OldPrintIndex { version: 1; items: Record<string, OldPrintItem> }

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(arg('out') ?? 'public/desk/oldprint.json');
const perItem = Number(arg('per-item') ?? '20');

async function load(): Promise<OldPrintIndex> {
  try { const j = JSON.parse(await fsp.readFile(out, 'utf8')); if (j?.version === 1 && j.items) return j; } catch { /* first run */ }
  return { version: 1, items: {} };
}
async function textFor(id: string): Promise<string> {
  const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_hocr_searchtext.txt.gz`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
  return gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
}
async function main(): Promise<void> {
  const idx = await load();
  const jobs: { id: string; get: () => Promise<string> }[] = [];
  const file = arg('file');
  if (file) jobs.push({ id: arg('id') ?? path.basename(file), get: async () => { const b = await fsp.readFile(file); return (file.endsWith('.gz') ? gunzipSync(b) : b).toString('utf8'); } });
  else { const ids = (await fsp.readFile(arg('ids') ?? 'ids.txt', 'utf8')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); for (const id of ids) jobs.push({ id, get: () => textFor(id) }); }
  let done = 0; let skipped = 0; let failed = 0;
  for (const j of jobs) {
    if (idx.items[j.id]?.normalizerVersion === NORMALIZER_VERSION) { skipped++; continue; }
    try { idx.items[j.id] = { identifier: j.id, normalizerVersion: NORMALIZER_VERSION, scannedAt: new Date().toISOString(), sentences: findSentences(await j.get(), perItem) }; done++; }
    catch (e) { failed++; console.error(e instanceof Error ? e.message : e); }
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp`; await fsp.writeFile(tmp, JSON.stringify(idx)); await fsp.rename(tmp, out);
  console.log(`oldprint index: ${done} scanned, ${skipped} unchanged, ${failed} failed, ${Object.keys(idx.items).length} total -> ${out}`);
  if (failed && !done && !skipped) process.exit(1);
}
main();
