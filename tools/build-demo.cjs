const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'tools', 'demo-fixtures');
const staging = path.join(root, 'public', 'demo');
const output = path.join(root, 'dist-demo');

if (process.env.VITE_AJN_DEMO !== '1') {
  console.error('Set VITE_AJN_DEMO=1 before running build:demo.');
  process.exit(2);
}
if (fs.existsSync(staging)) {
  console.error('Refusing to overwrite public/demo; remove it or inspect it first.');
  process.exit(2);
}
for (const name of ['synthetic.webm', 'english.vtt']) {
  if (!fs.existsSync(path.join(source, name))) {
    console.error(`Missing demo fixture: ${path.relative(root, path.join(source, name))}`);
    process.exit(2);
  }
}

fs.mkdirSync(staging, { recursive: true });
for (const name of ['synthetic.webm', 'english.vtt']) {
  fs.copyFileSync(path.join(source, name), path.join(staging, name));
}

let exitCode = 1;
try {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [vite, 'build', '--outDir', 'dist-demo'], {
    cwd: root,
    env: { ...process.env, VITE_AJN_DEMO: '1' },
    stdio: 'inherit',
  });
  exitCode = result.status ?? 1;
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

if (exitCode === 0) {
  console.log('PASS demo assets were staged only for the demo build; output: dist-demo/demo/');
}
process.exit(exitCode);
