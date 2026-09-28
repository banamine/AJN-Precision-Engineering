/* Checks every hard-coded Archive link in the app against Archive's file list.
 *   npx tsx scripts/check-archive-links.ts        (exit 1 if any link is broken)
 * A hard-coded file name that Archive doesn't have is a guaranteed 404 in the
 * player (e.g. the Home page's Apollo 11 link pointed at a file that never existed). */
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILES = ['guideRegistry.ts', 'channels.ts', 'src/App.tsx', ...fs.readdirSync('src/components').filter((f) => /\.tsx?$/.test(f)).map((f) => `src/components/${f}`)];
const found = new Map<string, string[]>();
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\/download\/([A-Za-z0-9_.%-]+)\/([^'"`\s)]+)/g)) {
    const key = `/download/${m[1]}/${m[2]}`;
    found.set(key, [...(found.get(key) ?? []), f]);
  }
}
const get = async (url: string) => {
  if (process.env.AJN_FETCH === 'curl') return JSON.parse(execFileSync('curl', ['-s', '--max-time', '30', url]).toString() || '{}');
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); return r.ok ? r.json() : {};
};
let bad = 0;
const meta = new Map<string, any>();
for (const [p, where] of found) {
  const [, , id, ...rest] = p.split('/');
  const file = decodeURIComponent(rest.join('/').split('?')[0]);
  if (!meta.has(id)) meta.set(id, await get(`https://archive.org/metadata/${id}`).catch(() => ({})));
  const m = meta.get(id);
  // TV News files are private as a whole but served as clips (?start=&end=), so a clip link may point at a private file.
  const clip = /[?&]start=\d/.test(p);
  const ok = Array.isArray(m.files) && m.files.some((f: any) => f.name === file && (clip || String(f.private) !== 'true'));
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${p}${ok ? '' : `  <- ${m.files ? 'file not in item' : 'item missing/dark'} (${[...new Set(where)].join(', ')})`}`);
}
console.log(`\n${found.size - bad}/${found.size} links OK`);
process.exit(bad ? 1 : 0);
