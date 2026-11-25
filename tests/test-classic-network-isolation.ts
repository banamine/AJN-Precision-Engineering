import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const f of ['extraChannelsManifest', 'documentariesManifest', 'archiveAudioChannels']) {
  const raw = fs.readFileSync(`src/data/${f}.json`, 'utf8');
  assert(!raw.includes('"classic-network"')); assert(!raw.includes('"classic-movies"'));
}
const source = fs.readFileSync('tools/build-infobattalion-lists.py', 'utf8');
const helper = source.match(/def generated_channel[\s\S]*?(?=\ndef )/)?.[0];
assert(helper, 'Existing builder helper found');
assert(!helper.includes('classic-network') && !helper.includes('classic-movies'));
console.log('CLASSIC_NETWORK_ISOLATION_PASS cases=8');
