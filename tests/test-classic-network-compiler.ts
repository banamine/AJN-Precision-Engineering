import assert from 'node:assert/strict';
import { assertRepeat, HOUR, dayBounds, localInstant, poolSeries, compileNetwork, publicationHash,
  type NetworkSettings, type NetworkConfig, type NetworkCatalog } from './server/classicNetwork';
let cases = 0;
function record(name: string, f: () => void) { f(); cases++; console.log(`PASS ${name}`); }
export const fixtureNetwork: NetworkConfig = { id: 'classic-network', name: 'SYNTHETIC', guideId: 'classic-tv',
  owner: 'banamine', catalogRef: 'fixture', pools: { all: { series: ['fixture'], rotateEveryWeeks: 1, offset: 0 } },
  lineup: [{ start: '00:00', end: '24:00', pool: 'all' }] };
export const fixtureSettings: NetworkSettings = { stationZone: 'America/Los_Angeles', originMonday: '2026-10-26',
  activeFrom: '2026-10-26T00:00:00 America/Los_Angeles', horizonDays: 10, repeatGapHours: 168, networks: {} };
export const fixtureCatalog: NetworkCatalog = { schema: 1, assets: Array.from({ length: 200 }, (_, i) => ({
  episodeKey: `fixture:s01e${i}`, assetId: `fixture-${i}`, show: 'fixture', title: `SYNTHETIC ${i}`,
  archivePath: `/download/SYNTHETIC/${i}.mp4`, durationSeconds: 3600, sources: ['fixture'],
})) };
const defaultFixtureNetwork = fixtureNetwork;
for (const id of ['classic-network', 'classic-movies']) {
const fixtureNetwork = { ...defaultFixtureNetwork, id, guideId: id === 'classic-movies' ? 'movies-classics-vault' : 'classic-tv' };
const check = (name: string, f: () => void) => record(`${id}: ${name}`, f);
check('168h minus 1ms rejects', () => assert.throws(() => assertRepeat([{ episodeKey: 'x', start: 0 }, { episodeKey: 'x', start: 168 * HOUR - 1 }], 168 * HOUR)));
check('exactly 168h accepts', () => assertRepeat([{ episodeKey: 'x', start: 0 }, { episodeKey: 'x', start: 168 * HOUR }], 168 * HOUR));
check('fall 25 elapsed hours', () => { const [s, e] = dayBounds('2026-11-01', fixtureSettings.stationZone); assert.equal(e - s, 25 * HOUR); });
check('spring 23 elapsed hours', () => { const [s, e] = dayBounds('2027-03-14', fixtureSettings.stationZone); assert.equal(e - s, 23 * HOUR); });
check('ambiguous time rejects', () => assert.throws(() => localInstant('2026-11-01', '01:30', fixtureSettings.stationZone)));
check('nonexistent time rejects', () => assert.throws(() => localInstant('2027-03-14', '02:30', fixtureSettings.stationZone)));
check('lane in ambiguous zone rejects', () => assert.throws(() => compileNetwork(fixtureSettings, { ...fixtureNetwork,
  lineup: [{ start: '00:00', end: '02:00', pool: 'all' }, { start: '02:00', end: '24:00', pool: 'all' }] }, fixtureCatalog)));
check('empty pool rejects', () => assert.throws(() => compileNetwork(fixtureSettings, { ...fixtureNetwork, pools: { all: { series: [], rotateEveryWeeks: 1, offset: 0 } } }, fixtureCatalog)));
check('pool rotation ignores ISO year and supports multiple weeks', () => {
  const p = { series: ['a', 'b'], rotateEveryWeeks: 2, offset: 0 };
  assert.equal(poolSeries(p, '2015-12-28', '2015-12-28'), 'a');
  assert.equal(poolSeries(p, '2016-01-04', '2015-12-28'), 'a');
  assert.equal(poolSeries(p, '2016-01-11', '2015-12-28'), 'b');
  assert.equal(poolSeries({ ...p, series: ['only'] }, '2016-01-11', '2015-12-28'), 'only');
});
check('date before origin rejects', () => assert.throws(() => poolSeries(fixtureNetwork.pools.all, '2026-10-25', '2026-10-26')));
check('shared series cursor across lanes', () => {
  const n = { ...fixtureNetwork, lineup: [{ start: '00:00', end: '12:00', pool: 'all' }, { start: '12:00', end: '24:00', pool: 'all' }] };
  const p = compileNetwork(fixtureSettings, n, fixtureCatalog);
  assert.equal(p.programs[12].metadata?.episodeKey, 'fixture:s01e12');
});
check('deterministic compiler and valid content hash', () => {
  const a = compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog), b = compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog);
  assert.deepEqual(a, b); assert.equal(a.revision, publicationHash(a));
  assert.equal(publicationHash(a), publicationHash({ ...a, tzdbNote: 'Different host/timezone database diagnostic' }));
});
if (id === 'classic-network') {
  const cfg = JSON.parse(await import('node:fs').then(m => m.readFileSync('config/classic-networks.json', 'utf8'))).networks['classic-network'];
  check('all six lane caps, Taxi minimum, all pools used, no 01:00-03:00 boundary', () => {
    const hours: Record<string, number> = {};
    const used = new Set<string>();
    for (const lane of cfg.lineup) {
      const [sh, sm] = lane.start.split(':').map(Number), [eh, em] = lane.end.split(':').map(Number);
      assert(!(sh > 1 && sh < 3), `lane start inside protected hours: ${lane.start}`);
      const pool = cfg.pools[lane.pool]; assert(pool); used.add(lane.pool);
      assert.equal(pool.series.length, 1, 'the first lineup has no undisclosed/unbalanced rotating pool');
      const show = pool.series[0]; hours[show] = (hours[show] ?? 0) + ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    }
    assert.deepEqual([...Object.keys(cfg.pools)].sort(), [...used].sort());
    assert.deepEqual(Object.keys(hours).sort(), ['benson', 'danger-man', 'dick-van-dyke', 'get-smart', 'hogans-heroes', 'taxi'].sort());
    assert(Object.values(hours).every(v => v <= 4.5));
    assert(hours.taxi >= 3);
  });
}
check('midnight overrun stays one occurrence and skips expired lane', () => {
  const n = { ...fixtureNetwork, lineup: [{ start: '00:00', end: '03:00', pool: 'all' }, { start: '03:00', end: '04:00', pool: 'all' }, { start: '04:00', end: '24:00', pool: 'all' }] };
  const c = { ...fixtureCatalog, assets: fixtureCatalog.assets.map(a => ({ ...a, durationSeconds: 25 * 3600 })) };
  const p = compileNetwork({ ...fixtureSettings, horizonDays: 3 }, n, c);
  assert.equal(p.programs.length, 3); assert.equal(p.checkpoint.cursors.fixture, 3);
  assert.equal(Date.parse(p.programs[0].endTimeUtc!) - Date.parse(p.programs[0].startTimeUtc!), 25 * HOUR);
  assert(p.missedLaneLog.length > 0);
});
check('checkpoint extension reproduces approved prefix and full replay', () => {
  const old = compileNetwork({ ...fixtureSettings, horizonDays: 5 }, fixtureNetwork, fixtureCatalog);
  const next = compileNetwork({ ...fixtureSettings, activeFrom: '2026-10-30T00:00:00 America/Los_Angeles', horizonDays: 6 }, fixtureNetwork, fixtureCatalog, old);
  const oldPrefix = old.programs.filter(p => p.startTimeUtc! < '2026-10-30T07:00:00.000Z');
  assert.deepEqual(next.programs.slice(0, oldPrefix.length), oldPrefix);
  const replay = compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog);
  assert.deepEqual(next.programs.map(p => [p.id, p.startTimeUtc, p.endTimeUtc]), replay.programs.map(p => [p.id, p.startTimeUtc, p.endTimeUtc]));
});
check('backdating rejects', () => {
  const p = compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog);
  assert.throws(() => compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog, p));
});
check('new catalog revision preserves prefix and migrates by episode identity', () => {
  const old = compileNetwork({ ...fixtureSettings, horizonDays: 5 }, fixtureNetwork, fixtureCatalog);
  const added = { ...fixtureCatalog, assets: [...fixtureCatalog.assets, { ...fixtureCatalog.assets[0], episodeKey: 'fixture:s01e201', assetId: 'new' }] };
  const next = compileNetwork({ ...fixtureSettings, activeFrom: '2026-10-30T00:00:00 America/Los_Angeles', horizonDays: 6 }, fixtureNetwork, added, old);
  const prefix = old.programs.filter(p => p.startTimeUtc! < '2026-10-30T07:00:00.000Z');
  assert.deepEqual(next.programs.slice(0, prefix.length), prefix);
  assert.equal(next.programs[prefix.length].metadata?.episodeKey, 'fixture:s01e96');
});
}
console.log(`CLASSIC_NETWORK_COMPILER_PASS cases=${cases} networks=2 (SYNTHETIC offline fixtures)`);
