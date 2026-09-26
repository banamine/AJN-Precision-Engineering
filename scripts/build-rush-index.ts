/** Build src/data/rushIndex.json — the Rush master index (identifier + date only).
 *  Run: npm run rush:index            (default query below)
 *       npm run rush:index -- "<advancedsearch query>"
 *  Paged, deterministic, and it leaves the old file alone if nothing is found. */
import { renameSync, writeFileSync } from 'node:fs';

const QUERY = process.argv[2] || 'identifier:rush-limbaugh-radio-show-*';
const ROWS = 1000;
const out = new URL('../src/data/rushIndex.json', import.meta.url);

type Doc = { identifier: string; date?: string };
const docs: Doc[] = [];
let invalid = 0;
for (let page = 1; ; page++) {
  const url = 'https://archive.org/advancedsearch.php'
    + `?q=${encodeURIComponent(QUERY)}&fl[]=identifier&fl[]=date&rows=${ROWS}&page=${page}&output=json`;
  let body: any = null;
  for (let attempt = 1; attempt <= 3 && !body; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (rush index)' } });
    if (r.ok) body = await r.json();
    else { console.warn(`page ${page}: HTTP ${r.status} (attempt ${attempt})`); await new Promise((s) => setTimeout(s, 2000 * attempt)); }
  }
  if (!body) { console.error(`page ${page} failed — file left unchanged`); process.exit(1); }
  const batch: Doc[] = body.response?.docs ?? [];
  docs.push(...batch);
  const total = body.response?.numFound ?? 0;
  console.log(`page ${page}: ${batch.length} (${docs.length}/${total})`);
  if (batch.length < ROWS || docs.length >= total) break;
  await new Promise((s) => setTimeout(s, 500)); // be gentle with Archive
}

const seen = new Set<string>();
const index = docs.flatMap((d) => {
  const date = String(d.date ?? '').slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    ?? d.identifier.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/)?.slice(1, 4).join('-');
  if (!date || seen.has(d.identifier)) { invalid++; return []; }
  seen.add(d.identifier);
  return [{ id: d.identifier, date, year: Number(date.slice(0, 4)) }];
}).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

console.log(`Rush episodes discovered: ${docs.length}`);
console.log(`Index records written:   ${index.length}`);
console.log(`Invalid/duplicate:       ${invalid}`);
if (!index.length) { console.error('nothing indexed — check the query; file left unchanged'); process.exit(1); }
const tmp = new URL('../src/data/rushIndex.json.tmp', import.meta.url);
writeFileSync(tmp, JSON.stringify(index));
renameSync(tmp, out);
console.log('wrote src/data/rushIndex.json');
process.exit(0);
