// Rolling playability probe for the concert manifest. Slow on purpose: meant for a GitHub Actions job.
// Each run probes the next --batch tracks (cursor kept in --state, persisted between runs by actions/cache),
// wrapping around until every track has been checked. One tiny Range request per track straight at archive.org
// (same URL construction as server/concertPools.ts, same per-segment encoding). Temporary 5xx/429/network errors
// are retried with backoff; what still fails is reported as FAILED (never hidden, never silently removed).
//   node tools/probe-concert-tracks.mjs [--manifest src/data/concertPoolsManifest.json] [--batch 1500] [--pace 1200]
//        [--state .catalog-cache/concert-probe-state.json] [--out reports/concert-probe.json] [--fail-over 0.01]
// Exit 0 = ok, 1 = failure rate over --fail-over (default 1%) in this batch, 2 = could not read manifest.
import fs from 'node:fs';
import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const manifestPath = arg('manifest', 'src/data/concertPoolsManifest.json');
const batch = +arg('batch', 1500), pace = +arg('pace', 1200), failOver = +arg('fail-over', 0.01);
const statePath = arg('state', '.catalog-cache/concert-probe-state.json'), outPath = arg('out', 'reports/concert-probe.json');
let m; try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { console.error('cannot read manifest:', e.message); process.exit(2); }
const tracks = [];
for (const p of m.pools) for (const c of p.concerts) for (const t of c.tracks) tracks.push({ pool: p.id, id: c.id, f: t.f });
tracks.sort((a, b) => (a.id + '/' + a.f).localeCompare(b.id + '/' + b.f));
const total = tracks.length;
let state = { cursor: 0, cycle: 0, failures: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}
const url = t => `https://archive.org/download/${encodeURIComponent(t.id)}/${t.f.split('/').map(encodeURIComponent).join('/')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function probe(t) {
  let last = '';
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url(t), { headers: { Range: 'bytes=0-1', 'User-Agent': 'AJN-Precision-Engineering/ConcertProbe' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const ct = r.headers.get('content-type') ?? '';
      await r.arrayBuffer().catch(() => {});
      if ((r.status === 206 || r.status === 200) && /^audio\//i.test(ct)) return { ok: true };
      last = `HTTP ${r.status} ${ct}`;
      if (r.status < 500 && r.status !== 429) break;     // 4xx other than 429 is a real answer, do not retry
    } catch (e) { last = 'network ' + (e.cause?.code ?? e.message); }
    await sleep(2000 * a);
  }
  return { ok: false, why: last };
}
const start = state.cursor % total, n = Math.min(batch, total);
const results = []; let bad = 0;
for (let i = 0; i < n; i++) {
  const t = tracks[(start + i) % total], key = t.id + '/' + t.f;
  const r = await probe(t);
  if (r.ok) delete state.failures[key]; else { bad++; state.failures[key] = { why: r.why, pool: t.pool, lastSeen: new Date().toISOString() }; console.log('FAILED', r.why, key); }
  results.push(r.ok);
  if ((i + 1) % 100 === 0) console.log(`${i + 1}/${n} probed, ${bad} failed`);
  await sleep(pace);
}
const end = start + n; if (end >= total) state.cycle++;
state.cursor = end % total; state.total = total;
fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(state));
const report = { generatedAt: new Date().toISOString(), manifest: manifestPath, totalTracks: total, probedThisRun: n, failedThisRun: bad,
  coverage: { cursor: state.cursor, completedCycles: state.cycle, nextBatchStartsAt: state.cursor }, openFailures: Object.keys(state.failures).length, failures: state.failures };
fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`\n${n - bad}/${n} playable this run; ${report.openFailures} open failure(s) overall; cursor ${state.cursor}/${total}`);
process.exit(bad / n > failOver ? 1 : 0);
