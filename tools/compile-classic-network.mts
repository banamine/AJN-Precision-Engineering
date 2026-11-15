import fs from 'node:fs';
import { compileNetwork, evidenceReport, type NetworkSettings, type NetworkCatalog, type Publication } from '../server/classicNetwork';
const args = process.argv.slice(2);
const get = (key: string) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
try {
  const settings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8')) as NetworkSettings;
  const name = get('--network') ?? 'classic-network', network = settings.networks[name];
  if (!network) throw new Error(`Unknown network ${name}`);
  if (get('--active-from')) settings.activeFrom = get('--active-from')!;
  const files: Record<string, string> = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };
  const file = network.publicationRef ?? files[name];
  if (!file) throw new Error(`No publication file for ${name}`);
  const priorPath = get('--previous');
  const previous = priorPath ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) as Publication : undefined;
  // --active-from also overrides a network's own activeFrom (renewal seam).
  if (get('--active-from')) network.activeFrom = get('--active-from')!;
  // Do not destroy a last-good artifact if compilation/validation fails.
  const catalog = JSON.parse(fs.readFileSync(network.catalogRef, 'utf8')) as NetworkCatalog;
  const publication = compileNetwork(settings, network, catalog, previous);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(publication)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  const out: Record<string, unknown> = { network: name, revision: publication.revision, programs: publication.programs.length, activeFrom: publication.activeFrom,
    coveredUntil: new Date(publication.coveredUntilUtcMs).toISOString(), bytes: fs.statSync(file).size };
  if (network.schedulingMode && network.schedulingMode !== 'lanes') {
    // Phase 3 evidence: cycle hours, min/max repeat gap (>= 168h), airings per show per 24h, first-time episodes, rule relaxations.
    const evidence = evidenceReport(publication, catalog, network);
    fs.mkdirSync('reports/classic-network', { recursive: true });
    fs.writeFileSync(`reports/classic-network/${name}-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    out.minGapHours = evidence.minGapHours; out.cycleHours = evidence.cycleHours; out.ruleRelaxations = evidence.ruleRelaxations;
  }
  console.log(JSON.stringify(out));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
