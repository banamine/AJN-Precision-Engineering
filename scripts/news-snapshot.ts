/** Rebuild src/data/newsSnapshot.json from live Archive TV News.
 *  Run: npm run news:snapshot  (then commit + push the JSON). */
import { writeFileSync, renameSync } from 'node:fs';
import { refreshCableNews, exportNewsSnapshot } from '../guideRegistry';
import { validateNewsSnapshot } from '../server/newsSnapshot';

const out = new URL('../src/data/newsSnapshot.json', import.meta.url);
await refreshCableNews();
const snap = validateNewsSnapshot(exportNewsSnapshot());
if (!snap) { console.error('news snapshot: no playable shows fetched — file left unchanged'); process.exit(1); }
snap.version = Date.parse(snap.fetchedAt);
const tmp = new URL('../src/data/newsSnapshot.json.tmp', import.meta.url);
writeFileSync(tmp, JSON.stringify(snap));
renameSync(tmp, out);
for (const c of snap.channels) console.log(`${c.name.padEnd(16)} ${c.programs.length} shows`);
console.log(`wrote src/data/newsSnapshot.json (${snap.fetchedAt})`);
process.exit(0);
