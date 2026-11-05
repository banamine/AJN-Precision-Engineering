// Run from the repo root: npx tsx tests/test-classic-network-zip11.ts   (offline; 0 network requests)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compileNetwork, publicationHash, assertRepeat, HOUR, type NetworkCatalog, type NetworkSettings, type Publication } from '../server/classicNetwork';
import { validatePublication, createPublicationReader } from '../server/classicNetworkPublication';
import { fileNamesShow, cleanTitle, episodeCode } from '../tools/build-classic-network-catalog.mts';

const settings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8')) as NetworkSettings;
const net = settings.networks['classic-network'];
const catalog = JSON.parse(fs.readFileSync(net.catalogRef, 'utf8')) as NetworkCatalog;
const pub = JSON.parse(fs.readFileSync('src/data/classicNetworkPublication.json', 'utf8')) as Publication;
let n = 0; const ok = (name: string, fn: () => void) => { fn(); n++; console.log('PASS', name); };

ok('config compiles with no flags and equals the shipped artifact', () => {
  const again = compileNetwork(settings, net, catalog);
  assert.equal(again.revision, pub.revision);
  assert.equal(JSON.stringify(again.programs), JSON.stringify(pub.programs));
});
ok('revision ignores tzdbNote (machine text)', () => {
  assert.equal(publicationHash({ ...pub, tzdbNote: 'Intl tzdb 1999z; Node 1.0.0' }), pub.revision);
  assert.equal(publicationHash(pub), pub.revision);
});
ok('artifact validates; contiguous; unique ids; 168 h gate on every start', () => {
  validatePublication(pub);
  assertRepeat(pub.programs.map(p => ({ episodeKey: String(p.metadata!.episodeKey), start: Date.parse(p.startTimeUtc!) })), 168 * HOUR);
});
ok('starts at activation and covers 60 days', () => {
  assert.equal(pub.activeFrom, '2026-11-04T08:00:00.000Z');
  assert.ok(pub.coveredUntilUtcMs - Date.parse(pub.activeFrom) >= 60 * 24 * HOUR);
});
ok('every catalog file name names its show (no Cagney & Lacey on Taxi)', () => {
  for (const a of catalog.assets) {
    const file = decodeURIComponent(a.archivePath.split('/').slice(3).join('/'));
    const id = decodeURIComponent(a.archivePath.split('/')[2]);
    assert.ok((fileNamesShow as (s: string, f: string, i: string) => boolean)(a.show, file, id), `${a.show}: ${file}`);
  }
  assert.ok(!catalog.assets.some(a => /cagney|charlie'?s angels|supernatural/i.test(a.archivePath)));
});
ok('viewer titles come from the file, not an unrelated catalogue title', () => {
  assert.ok(!catalog.assets.some(a => /Destination Danger/.test(a.title)));
  assert.equal((cleanTitle as (s: string, f: string, c: null) => string)('danger-man', 'Series 1/01 View from the Villa.mp4', null), 'Danger Man (Series 1) — View from the Villa');
  assert.equal((cleanTitle as (s: string, f: string, c: { season: number; episode: number }) => string)('hogans-heroes', "Hogans Heroes s1e01.mp4", (episodeCode as (t: string) => { season: number; episode: number })('Hogans Heroes s1e01.mp4')), "Hogan's Heroes S01E01");
});
ok('no show over 6.5 h/day average; every lane pool used', () => {
  const hours = new Map<string, number>();
  for (const p of pub.programs) hours.set(String(p.metadata!.show), (hours.get(String(p.metadata!.show)) ?? 0) + (Date.parse(p.endTimeUtc!) - Date.parse(p.startTimeUtc!)) / HOUR);
  const days = (pub.coveredUntilUtcMs - Date.parse(pub.activeFrom)) / (24 * HOUR);
  for (const [, h] of hours) assert.ok(h / days <= 6.5);
  assert.equal(hours.size, 6);
});
ok('reader: before start / ok / after end are explicit', () => {
  const r = createPublicationReader(pub);
  assert.ok(r.getWindow(Date.parse(pub.activeFrom) - 1).error?.startsWith('Schedule starts'));
  assert.equal(r.getWindow(Date.parse(pub.activeFrom) + 1000).error, undefined);
  assert.ok(r.getWindow(pub.coveredUntilUtcMs).error?.startsWith('Schedule ends'));
});
console.log(`CLASSIC_NETWORK_ZIP11_PASS cases=${n}`);
