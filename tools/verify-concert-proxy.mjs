// Verifies concert track paths through the running app's proxy. Run the app first (npm run dev), then:
//   node tools/verify-concert-proxy.mjs [manifest.json] [--base http://localhost:3000] [--all]
// Default manifest: reports/concert-discovery/concertPoolsManifest.staging.json (falls back to src/data/concertPoolsManifest.json).
// Checks every track whose filename has URL-special characters (# & % ' ( ) [ ] + ; = , !) plus the first track of each concert
// (with --all: every track). Uses the SAME URL construction as server/concertPools.ts + guideRegistry toProxy().
// PASS = 206 (or 200), audio/* content-type, body <= 8 MiB, Content-Range present. Anything else is printed and exits 1. No retries, no fallbacks.
import fs from 'node:fs';
const args = process.argv.slice(2);
const base = (args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3000').replace(/\/$/, '');
const all = args.includes('--all');
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base') ??
  (fs.existsSync('reports/concert-discovery/concertPoolsManifest.staging.json') ? 'reports/concert-discovery/concertPoolsManifest.staging.json' : 'src/data/concertPoolsManifest.json');
const SPECIAL = /[#&%'()\[\]+;=,!]/;
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
const dl = (id, f) => `/download/${encodeURIComponent(id)}/${f.split('/').map(encodeURIComponent).join('/')}`;
const jobs = [];
for (const p of m.pools) for (const c of p.concerts) c.tracks.forEach((t, i) => {
  if (all || i === 0 || SPECIAL.test(t.f)) jobs.push({ pool: p.id, id: c.id, f: t.f, special: SPECIAL.test(t.f) });
});
let bad = 0, n = 0;
for (const j of jobs) {
  const url = `${base}/api/archive/proxy?path=${encodeURIComponent(dl(j.id, j.f))}`;
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') ?? '', cr = r.headers.get('content-range');
    const ok = (r.status === 206 || r.status === 200) && /^audio\//i.test(ct) && buf.length > 0 && buf.length <= 8 * 1024 * 1024 && (r.status === 200 || !!cr);
    n++; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${r.status} ${ct || '-'} ${cr || '-'} ${j.special ? '[special] ' : ''}${j.id}/${j.f}`);
  } catch (e) { n++; bad++; console.log(`FAIL network ${j.id}/${j.f}: ${e.message}`); }
}
console.log(`\n${n - bad}/${n} passed against ${base}`);
process.exit(bad ? 1 : 0);
