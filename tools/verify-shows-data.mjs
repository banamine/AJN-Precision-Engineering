// Read-only check of the Shows data and the Westerns publication. Run from the repo root: node tools/verify-shows-data.mjs
import fs from 'node:fs';
let bad = 0; const fail = (m) => { console.error('FAIL', m); bad++; };
const d = JSON.parse(fs.readFileSync('src/data/showDrawers.json', 'utf8'));
const ids = new Set();
for (const s of d.shows) {
  if (ids.has(s.id)) fail('duplicate show id ' + s.id); ids.add(s.id);
  const f = `src/data/showEpisodes/${s.id}.json`;
  if (!fs.existsSync(f)) { fail('missing ' + f); continue; }
  const eps = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (eps.length !== s.episodes) fail(`${s.id}: episodes ${eps.length} != ${s.episodes}`);
  if (eps.some((e) => !e.p.startsWith('/download/') || !(e.d === 0 || e.d >= 120))) fail(`${s.id}: bad path or duration`);
  if (!d.channels.some((c) => c.id === s.channelId && c.pills.includes(s.pill))) fail(`${s.id}: unknown channel/pill`);
}
const p = JSON.parse(fs.readFileSync('src/data/classicWesternsPublication.json', 'utf8'));
if (p.networkId !== 'classic-westerns' || !p.programs.length) fail('westerns publication invalid');
if (p.programs.some((x) => !x.archivePath?.startsWith('/download/'))) fail('westerns program without archivePath');
console.log(JSON.stringify({ shows: d.shows.length, episodes: d.shows.reduce((a, s) => a + s.episodes, 0), westernsPrograms: p.programs.length, coveredUntil: new Date(p.coveredUntilUtcMs).toISOString(), failures: bad }));
process.exit(bad ? 1 : 0);
