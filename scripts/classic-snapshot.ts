/** Rebuild src/data/classicSnapshot.json from the live daily-highlights playlists.
 *  Run: npm run classic:snapshot  (then commit + push the JSON). */
import { renameSync, writeFileSync } from 'node:fs';
import { exportClassicSnapshot } from '../guideRegistry';

const snap = await exportClassicSnapshot();
if (!snap || !snap.programs.length) { console.error('classic snapshot: nothing fetched — file left unchanged'); process.exit(1); }
const out = new URL('../src/data/classicSnapshot.json', import.meta.url);
const tmp = new URL('../src/data/classicSnapshot.json.tmp', import.meta.url);
writeFileSync(tmp, JSON.stringify(snap));
renameSync(tmp, out);
const shows = new Set(snap.programs.map((p: any) => p.channelId));
console.log(`wrote src/data/classicSnapshot.json: ${snap.programs.length} programs, ${shows.size} shows (${snap.fetchedAt})`);
process.exit(0);
