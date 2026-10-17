/* Builds src/data/audioItemSnapshot.json: the track list of every whole-item audio channel, so a cold server needs no Archive
 * calls to fill the Audio guide (same idea as src/data/newsSnapshot.json).
 *
 * Usage (needs archive.org reachable):
 *   npx tsx tools/build-audio-snapshot.ts                       # fetches /metadata/<id> for every itemId in archiveAudioChannels.json
 *   npx tsx tools/build-audio-snapshot.ts raw-metadata.json     # or build from a saved {items:{id:{files:[...]}}} dump
 * The MP3 filter/ordering is filesFromMetadata() in server/rush.ts, the same function the live resolver uses. */
import * as fs from 'node:fs';
import { filesFromMetadata } from '../server/rush';

const channels: Array<{ id: string; itemId: string }> = JSON.parse(fs.readFileSync('src/data/archiveAudioChannels.json', 'utf8'));
const ids = [...new Set(channels.map((c) => c.itemId))];
const rawFile = process.argv[2];
const raw: { fetchedAt?: string; items: Record<string, any> } = rawFile ? JSON.parse(fs.readFileSync(rawFile, 'utf8')) : { items: {} };

async function fetchMeta(id: string) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) return null;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  return null;
}

const items: Record<string, { resolvedAt: string; files: ReturnType<typeof filesFromMetadata> }> = {};
const missing: string[] = [];
const fetchedAt = raw.fetchedAt ?? new Date().toISOString();
for (const id of ids) {
  const meta = rawFile ? raw.items[id] : await fetchMeta(id);
  if (!meta || meta.dark) { missing.push(id); continue; }
  const files = filesFromMetadata(meta);
  if (!files.length) { missing.push(id); continue; }
  items[id] = { resolvedAt: fetchedAt, files };
}
fs.writeFileSync('src/data/audioItemSnapshot.json', JSON.stringify({ version: 1, fetchedAt, items }));
console.log(`snapshot: ${Object.keys(items).length}/${ids.length} items, ${Object.values(items).reduce((n, i) => n + i.files.length, 0)} tracks`);
if (missing.length) console.log('NOT in snapshot (still resolved live):', missing.join(', '));
