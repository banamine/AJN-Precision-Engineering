// Anchored patcher for the Home hub. Run from the project root:
//   node apply-hub.mjs --check   dry run: reports each edit as TODO / DONE / BLOCKED, writes nothing, exits 1 if anything is BLOCKED
//   node apply-hub.mjs           applies the TODO edits; first saves <file>.bak-hub (never overwritten)
// Each edit is independent: DONE = its result text is already there, TODO = its anchor matches exactly once, BLOCKED = neither (file differs from the base).
import fs from 'node:fs';
const check = process.argv.includes('--check');
const EDITS = [
  { file: 'src/components/HomeView.tsx', name: 'import hub', find: "import { HomeLiveStrip } from './HomeLiveStrip';", repl: "import { HomeBroadcastHub } from './HomeBroadcastHub';" },
  { file: 'src/components/HomeView.tsx', name: 'mount hub in place of the live strip', find: '<HomeLiveStrip onPlayProgram={onPlayProgram} onNavigate={onNavigate} />', repl: '<HomeBroadcastHub onPlayProgram={onPlayProgram} onNavigate={onNavigate} />' },
  { file: 'src/components/HomeView.tsx', name: 'legacy-rows switch (constant)', find: 'export function HomeView({ onNavigate,', repl: '/** Set to true once the hub is tested: hides the old On Now grid and RecentCarousel, which repeat what the hub shows. Default keeps them for rollback. */\nconst HUB_REPLACES_LEGACY_ROWS = false;\n\nexport function HomeView({ onNavigate,' },
  { file: 'src/components/HomeView.tsx', name: 'legacy-rows switch (open)', find: '          <section aria-labelledby="live-stations-heading" className="space-y-3">', repl: '          {!HUB_REPLACES_LEGACY_ROWS && (<>\n          <section aria-labelledby="live-stations-heading" className="space-y-3">' },
  { file: 'src/components/HomeView.tsx', name: 'legacy-rows switch (close)', find: '          <RecentCarousel now={now} onPlayProgram={onPlayProgram} onNavigate={onNavigate} playing={!!nowPlaying} />', repl: '          <RecentCarousel now={now} onPlayProgram={onPlayProgram} onNavigate={onNavigate} playing={!!nowPlaying} />\n          </>)}' },
  { file: 'server.ts', name: 'classic-48h route', find: 'const originOf=(req:any)=>', repl: `import { createClassicUpcoming } from './server/classicUpcoming';
const classicUpcoming=createClassicUpcoming({getChannels:async()=>{try{const s=await Promise.race([guideSnapshot('classic-tv'),new Promise<null>(r=>setTimeout(()=>r(null),3500))]);return s?s.channels:null}catch{return null}},now:()=>Date.now()});
app.get('/api/home/classic-48h',async(req,res)=>{const r=await classicUpcoming.handle(req.query.tz);res.status(r.status).set('Cache-Control','private, max-age=60').json(r.body);});
const originOf=(req:any)=>` },
];
const count = (s, t) => s.split(t).length - 1;
const files = new Map();
const read = (f) => { if (!files.has(f)) { if (!fs.existsSync(f)) throw new Error(`missing file: ${f} (run from the project root)`); files.set(f, fs.readFileSync(f, 'utf8')); } return files.get(f); };
let blocked = 0, todo = 0;
for (const e of EDITS) {
  const src = read(e.file);
  const nFind = count(src, e.find);
  const done = src.includes(e.repl);
  if (done) { console.log(`DONE     ${e.file}: ${e.name}`); continue; }
  if (nFind === 1) { console.log(`TODO     ${e.file}: ${e.name}`); todo++; files.set(e.file, src.replace(e.find, () => e.repl)); continue; }
  console.log(`BLOCKED  ${e.file}: ${e.name} (anchor matched ${nFind} times; expected 1)`); blocked++;
}
if (blocked) { console.log(`\n${blocked} edit(s) BLOCKED: this file differs from the export the patch was built on. Nothing was written. Use the full files instead.`); process.exit(1); }
if (check) { console.log(`\n--check: ${todo} edit(s) would be applied. Nothing written.`); process.exit(0); }
for (const f of new Set(EDITS.map((e) => e.file))) {
  const next = files.get(f); const cur = fs.readFileSync(f, 'utf8');
  if (next === cur) continue;
  if (!fs.existsSync(`${f}.bak-hub`)) fs.copyFileSync(f, `${f}.bak-hub`);
  fs.writeFileSync(f, next); console.log(`wrote ${f} (backup ${f}.bak-hub)`);
}
console.log(`applied ${todo} edit(s).`);
