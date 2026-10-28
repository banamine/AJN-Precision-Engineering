/** Build src/data/rushIndex.json — the role-aware Rush master index.
 *  Run: npm run rush:index            (default query below)
 *       npm run rush:index -- "<advancedsearch query>"
 *  Paged, deterministic, and it leaves the old file alone if nothing is found. */
import { renameSync, writeFileSync } from 'node:fs';

const QUERY = process.argv[2] || 'identifier:rush-limbaugh-radio-show*';
const ROWS = 1000;
const out = new URL('../src/data/rushIndex.json', import.meta.url);

type Doc = { identifier: string; date?: string; title?: string };
type RushRole = 'morning-update' | 'full-show';
type RushIndexEntry = { id: string; date: string; year: number; role: RushRole };
const docs: Doc[] = [];
const exclusions: Array<{ id: string; reason: string }> = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
for (let page = 1; ; page++) {
  const url = 'https://archive.org/advancedsearch.php'
    + `?q=${encodeURIComponent(QUERY)}&fl[]=identifier&fl[]=date&fl[]=title&rows=${ROWS}&page=${page}&sort[]=${encodeURIComponent('identifier asc')}&output=json`;
  const r = await fetch(url, { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (rush index)' } });
  if (!r.ok) {
    console.error(`page ${page}: HTTP ${r.status} — file left unchanged`);
    process.exit(1);
  }
  const body: any = await r.json();
  const batch: Doc[] = body.response?.docs ?? [];
  docs.push(...batch);
  const total = body.response?.numFound ?? 0;
  console.log(`page ${page}: ${batch.length} (${docs.length}/${total})`);
  if (batch.length < ROWS || docs.length >= total) break;
  await wait(1500); // keep the public Archive search endpoint paced
}

function validCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === value;
}

const seen = new Set<string>();
const index: RushIndexEntry[] = [];
for (const doc of docs) {
  const id = String(doc.identifier ?? '').trim();
  const dateMatch = id.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) {
    exclusions.push({ id, reason: 'identifier has no full YYYY-MM-DD suffix' });
    continue;
  }
  const date = dateMatch[1];
  if (!validCalendarDate(date)) {
    exclusions.push({ id, reason: `invalid calendar date ${date}` });
    continue;
  }
  if (seen.has(id)) {
    exclusions.push({ id, reason: 'duplicate identifier' });
    continue;
  }
  seen.add(id);
  const role: RushRole = /(?:^|-)morning-update-\d{4}-\d{2}-\d{2}$/.test(id)
    ? 'morning-update'
    : 'full-show';
  index.push({ id, date, year: Number(date.slice(0, 4)), role });
}

index.sort((a, b) =>
  a.date.localeCompare(b.date)
  || (a.role === b.role ? a.id.localeCompare(b.id) : a.role === 'morning-update' ? -1 : 1)
);

const roleCounts = index.reduce((counts, entry) => {
  counts[entry.role]++;
  return counts;
}, { 'morning-update': 0, 'full-show': 0 });
const rolesByDate = new Map<string, Set<RushRole>>();
for (const entry of index) {
  const roles = rolesByDate.get(entry.date) ?? new Set<RushRole>();
  roles.add(entry.role);
  rolesByDate.set(entry.date, roles);
}
const pairedDates = [...rolesByDate.values()].filter((roles) => roles.size === 2).length;

console.log(`Rush episodes discovered: ${docs.length}`);
console.log(`Index records written:   ${index.length}`);
console.log(`Morning Update records:  ${roleCounts['morning-update']}`);
console.log(`Full-show records:       ${roleCounts['full-show']}`);
console.log(`Dates with both roles:   ${pairedDates}`);
console.log(`Excluded records:        ${exclusions.length}`);
for (const exclusion of exclusions) console.log(`  exclude ${exclusion.id || '(empty identifier)'} — ${exclusion.reason}`);
if (!index.length) { console.error('nothing indexed — check the query; file left unchanged'); process.exit(1); }
const tmp = new URL('../src/data/rushIndex.json.tmp', import.meta.url);
writeFileSync(tmp, JSON.stringify(index));
renameSync(tmp, out);
console.log('wrote src/data/rushIndex.json');
process.exit(0);
