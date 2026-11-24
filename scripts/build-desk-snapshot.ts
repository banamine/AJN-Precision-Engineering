/* Usage:  npx tsx scripts/build-desk-snapshot.ts [--out public] [--per-beat 25] [--attempts 60]
 * Writes <out>/desk/desk.json and <out>/desk/thumbs/*.jpg. Needs internet access to Archive.org. */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import usgov from '../src/data/usgovLibrary.json';
import { makeSnapshot, type SnapshotFs } from '../server/deskSnapshotBuild';

const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'public'));
const fs: SnapshotFs = {
  async read(p) { try { return new Uint8Array(await fsp.readFile(path.join(out, p))); } catch { return null; } },
  async exists(p) { try { await fsp.access(path.join(out, p)); return true; } catch { return false; } },
  async write(p, data) { const f = path.join(out, p); await fsp.mkdir(path.dirname(f), { recursive: true }); const tmp = `${f}.tmp`; await fsp.writeFile(tmp, data); await fsp.rename(tmp, f); },
};
makeSnapshot({ fetchImpl: fetch, lib: (usgov as any).collections, fs, perBeat: Number(arg('per-beat', '25')), maxAttempts: Number(arg('attempts', '60')), log: (m) => console.log(m) })
  .then((r) => { console.log(`snapshot: ${r.feed.count} cards (${r.newItems} new), thumbnails saved ${r.thumbsSaved}, failed ${r.thumbsFailed}`); })
  .catch((e) => { console.error('snapshot failed:', e instanceof Error ? e.message : e); process.exit(1); });
