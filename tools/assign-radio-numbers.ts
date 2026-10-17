// Append-only station numbers for Radio -> Live radio. Run after adding stations:  npx tsx tools/assign-radio-numbers.ts
// Never renumbers: a station keeps its number forever; new stations get the next free number (in name order within this run).
import fs from 'node:fs';
import { queryLiveRadioStations } from '../server/liveRadio.ts';
const FILE = new URL('../server/data/liveRadioNumbers.json', import.meta.url);
const reg = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { version: 1, note: '', next: 1, numbers: {} };
const first = queryLiveRadioStations({ pageSize: 100, page: 1 });
const all: Array<{ id: string; name: string }> = [];
for (let p = 1; p <= Math.ceil(first.total / 100); p++) all.push(...queryLiveRadioStations({ pageSize: 100, page: p }).items);
const fresh = all.filter((s) => !(s.id in reg.numbers)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
for (const s of fresh) reg.numbers[s.id] = reg.next++;
reg.note = 'Station numbers for Radio -> Live radio. APPEND-ONLY: never edit or reuse a number. Regenerate with: npx tsx tools/assign-radio-numbers.ts';
fs.writeFileSync(FILE, JSON.stringify(reg));
console.log(`stations shown ${all.length}, newly numbered ${fresh.length}, registry size ${Object.keys(reg.numbers).length}, next ${reg.next}`);
