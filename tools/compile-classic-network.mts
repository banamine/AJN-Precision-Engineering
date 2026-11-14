import fs from 'node:fs';
import { compileNetwork, type NetworkSettings, type NetworkCatalog, type Publication } from '../server/classicNetwork';
const args = process.argv.slice(2);
const get = (key: string) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
try {
  const settings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8')) as NetworkSettings;
  const name = get('--network') ?? 'classic-network', network = settings.networks[name];
  if (!network) throw new Error(`Unknown network ${name}`);
  if (get('--active-from')) settings.activeFrom = get('--active-from')!;
  const files: Record<string, string> = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };
  const file = files[name];
  if (!file) throw new Error(`No publication file for ${name}`);
  const priorPath = get('--previous');
  const previous = priorPath ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) as Publication : undefined;
  // Do not destroy a last-good artifact if compilation/validation fails.
  const publication = compileNetwork(settings, network, JSON.parse(fs.readFileSync(network.catalogRef, 'utf8')) as NetworkCatalog, previous);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(publication)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  console.log(JSON.stringify({ network: name, revision: publication.revision, programs: publication.programs.length, activeFrom: publication.activeFrom,
    coveredUntil: new Date(publication.coveredUntilUtcMs).toISOString(), bytes: fs.statSync(file).size }));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
