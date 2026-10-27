// Writes hubh/classic48.json: the real /api/home/classic-48h body for the packaged Classic TV schedule at a fixed clock (2026-10-14 12:00 UTC, tz 0).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createClassicUpcoming } from '../server/classicUpcoming';
import { getScheduleForGuide } from '../guideRegistry';
const here = path.dirname(fileURLToPath(import.meta.url));
const now = Date.parse('2026-10-14T12:00:00Z');
const channels = await getScheduleForGuide('classic-tv', new Date(now));
const r = await createClassicUpcoming({ getChannels: async () => channels, now: () => now }).handle('0');
fs.writeFileSync(path.join(here, 'classic48.json'), JSON.stringify(r.body));
console.log('wrote classic48.json', r.status, (r.body as any).channels.length, 'channels');
