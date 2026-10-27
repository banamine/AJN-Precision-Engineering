/** Build src/data/rushIndex.json from the reviewed Rush scrape.
 *  Run from this repository: npm run rush:index -- ../generated-artifacts/rush_limbaugh_all_items.csv
 *  The identifier suffix is authoritative; invalid calendar dates and undated IDs are excluded. */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Role = 'morning-update' | 'full-show';
type Entry = { id: string; date: string; year: number; role: Role };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') {
      row.push(cell); cell = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else if (char !== '\r') cell += char;
  }
  if (quoted) throw new Error('Rush CSV ended inside a quoted field');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

const inputPath = resolve(process.cwd(), process.argv[2] ?? '../generated-artifacts/rush_limbaugh_all_items.csv');
const csvRows = parseCsv(readFileSync(inputPath, 'utf8'));
const header = csvRows.shift();
if (!header) throw new Error(`Rush CSV has no header: ${inputPath}`);
const identifierColumn = header.indexOf('identifier');
if (identifierColumn < 0) throw new Error('Rush CSV is missing the identifier column');

const seen = new Set<string>();
const entries: Entry[] = [];
const sourceRoleCounts: Record<Role, number> = { 'morning-update': 0, 'full-show': 0 };
let excludedUndated = 0;
let excludedInvalidDate = 0;
let duplicates = 0;
const excludedUndatedIds: string[] = [];
const excludedInvalidDateIds: string[] = [];

for (const row of csvRows) {
  const id = row[identifierColumn] ?? '';
  const morningPrefix = 'rush-limbaugh-radio-show-morning-update-';
  const fullPrefix = 'rush-limbaugh-radio-show-';
  const role: Role | null = id.startsWith(morningPrefix)
    ? 'morning-update'
    : id.startsWith(fullPrefix) ? 'full-show' : null;
  if (!role) {
    if (id.startsWith('rush-limbaugh-radio-show')) { excludedUndated++; excludedUndatedIds.push(id); }
    continue;
  }
  sourceRoleCounts[role]++;
  if (seen.has(id)) { duplicates++; continue; }
  seen.add(id);

  const prefix = role === 'morning-update' ? morningPrefix : fullPrefix;
  const date = id.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { excludedUndated++; excludedUndatedIds.push(id); continue; }
  if (!validDate(date)) { excludedInvalidDate++; excludedInvalidDateIds.push(id); continue; }
  entries.push({ id, date, year: Number(date.slice(0, 4)), role });
}

const roleOrder: Record<Role, number> = { 'morning-update': 0, 'full-show': 1 };
entries.sort((a, b) => a.date.localeCompare(b.date) || roleOrder[a.role] - roleOrder[b.role] || a.id.localeCompare(b.id));
const rolesByDate = new Map<string, Set<Role>>();
for (const entry of entries) {
  const roles = rolesByDate.get(entry.date) ?? new Set<Role>();
  roles.add(entry.role);
  rolesByDate.set(entry.date, roles);
}
const indexedRoleCounts = {
  'morning-update': entries.filter((entry) => entry.role === 'morning-update').length,
  'full-show': entries.filter((entry) => entry.role === 'full-show').length,
};
const pairedDates = [...rolesByDate.values()].filter((roles) => roles.has('morning-update') && roles.has('full-show')).length;

if (!entries.length) throw new Error('No valid Rush entries found; index left unchanged');
const out = new URL('../src/data/rushIndex.json', import.meta.url);
const tmp = new URL('../src/data/rushIndex.json.tmp', import.meta.url);
writeFileSync(tmp, `${JSON.stringify(entries)}\n`);
renameSync(tmp, out);

console.log(`Source role counts: Morning Update ${sourceRoleCounts['morning-update']}; Full Show ${sourceRoleCounts['full-show']}`);
console.log(`Indexed role counts: Morning Update ${indexedRoleCounts['morning-update']}; Full Show ${indexedRoleCounts['full-show']}`);
console.log(`Dates with both roles: ${pairedDates}`);
console.log(`Excluded undated IDs: ${excludedUndated}`);
console.log(`Excluded invalid calendar dates: ${excludedInvalidDate}`);
if (excludedUndatedIds.length) console.log(`Undated IDs: ${excludedUndatedIds.join(', ')}`);
if (excludedInvalidDateIds.length) console.log(`Invalid-date IDs: ${excludedInvalidDateIds.join(', ')}`);
console.log(`Duplicate IDs skipped: ${duplicates}`);
console.log(`Index records written: ${entries.length}`);
console.log('wrote src/data/rushIndex.json');
