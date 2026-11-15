// Server bundle builder. Same as: esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
// Difference: JSON files over THRESHOLD are NOT inlined into the bundle (that made esbuild need ~2 GB and the bundle 55 MB).
// They are copied to dist/server-data/ and read from disk at runtime (dist/ always ships with server.cjs).
import { build } from 'esbuild';
import { statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const THRESHOLD = 256 * 1024;
const OUT = 'dist/server.cjs';
const DATA = 'dist/server-data';
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
const copied = new Map();

const externalLargeJson = {
  name: 'external-large-json',
  setup(b) {
    b.onLoad({ filter: /\.json$/ }, (args) => {
      if (statSync(args.path).size <= THRESHOLD) return undefined; // small: inline as before
      let name = copied.get(args.path);
      if (!name) {
        name = createHash('sha1').update(args.path).digest('hex').slice(0, 10) + '-' + path.basename(args.path);
        copyFileSync(args.path, path.join(DATA, name));
        copied.set(args.path, name);
      }
      return {
        loader: 'js',
        contents: `module.exports = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'server-data', ${JSON.stringify(name)}), 'utf8'));`,
      };
    });
  },
};

await build({
  entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs',
  packages: 'external', outfile: OUT, plugins: [externalLargeJson], logLevel: 'info',
});
console.log(`[build-server] ${copied.size} large JSON files kept out of the bundle -> ${DATA}`);
