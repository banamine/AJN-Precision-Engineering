const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const assetDir = path.join(root, 'dist', 'assets');
if (!fs.existsSync(assetDir)) {
  console.error('FAIL production bundle is missing dist/assets');
  process.exit(1);
}
const jsFiles = fs.readdirSync(assetDir).filter((file) => file.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('FAIL production bundle contains no JavaScript assets');
  process.exit(1);
}
const markers = ['AJN_DEMO_MODE', 'DEMO DATA — not live'];
const found = [];
for (const file of jsFiles) {
  const contents = fs.readFileSync(path.join(assetDir, file), 'utf8');
  for (const marker of markers) {
    if (contents.includes(marker)) found.push(`${file}: ${marker}`);
  }
}
if (found.length > 0 || fs.existsSync(path.join(root, 'dist', 'demo'))) {
  console.error(`FAIL demo-only content in production output:\n${found.join('\n')}${fs.existsSync(path.join(root, 'dist', 'demo')) ? '\ndist/demo exists' : ''}`);
  process.exit(1);
}
console.log(`PASS production bundle has no demo marker in ${jsFiles.length} JavaScript asset(s), and no dist/demo/`);
