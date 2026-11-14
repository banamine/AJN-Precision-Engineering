// Read-only observer. Never compiles, activates, renews, fetches media or writes files.
import fs from 'node:fs';
const args = process.argv.slice(2);
const i = args.indexOf('--network');
const network = i < 0 ? 'classic-network' : args[i + 1];
const files = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };
const file = files[network];
try {
  if (!file) throw new Error('Unknown network');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!p || p.schema !== 1 || p.networkId !== network || !Number.isFinite(p.coveredUntilUtcMs)) throw new Error('Missing/invalid publication');
  const remainingHours = (p.coveredUntilUtcMs - Date.now()) / 3600000;
  const code = remainingHours <= 72 ? 2 : remainingHours <= 14 * 24 ? 1 : 0;
  console.log(JSON.stringify({ network, revision: p.revision, coveredUntil: new Date(p.coveredUntilUtcMs).toISOString(),
    remainingHours, state: code === 2 ? 'critical' : code === 1 ? (remainingHours <= 7 * 24 ? 'warning-7d' : 'warning-14d') : 'ok' }));
  process.exitCode = code;
} catch (e) { console.error(`critical: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 2; }
