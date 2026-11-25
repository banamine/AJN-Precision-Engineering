import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildCatalog, movieIdentity, orderMovies, assertMovieCycle, movieVaultRows, episodeDisplayTitle } from '../tools/build-classic-network-catalog.mts';
import { compileNetwork, HOUR, type NetworkConfig, type NetworkSettings } from '../server/classicNetwork';

let cases = 0;
function check(name: string, f: () => void) { f(); cases++; console.log(`PASS ${name}`); }
const allowed = ['owner', 'owner-two'];
const row = { channelId: 'owner', identifier: 'SYNTHETIC', file: 'Film.mp4', title: 'My Film (1940)', year: 1940, durationSeconds: 7200 };
check('60 and 240 minutes inclusive; shorter/longer/missing rejected', () => {
  for (const durationSeconds of [3600, 14400]) assert.equal(buildCatalog([{ ...row, durationSeconds }], true, allowed).catalog.assets.length, 1);
  for (const durationSeconds of [3599, 14401, undefined, NaN]) assert.equal(buildCatalog([{ ...row, durationSeconds }], true, allowed).catalog.assets.length, 0);
});
check('private and estimated durations rejected', () => {
  for (const flags of [{ private: true }, { is_dark: true }, { restricted: true }, { durationEstimated: true }]) {
    assert.equal(buildCatalog([{ ...row, ...flags }], true, allowed).catalog.assets.length, 0);
  }
});
check('unapproved channels never admitted', () => {
  for (const channelId of ['mx-jt-s-ghost', 'mx-aiviixx', 'mx-random-movies', 'mx-lars-germany-mittank', 'mx-star-wars']) {
    const r = buildCatalog([{ ...row, channelId }], true, allowed);
    assert.equal(r.catalog.assets.length, 0); assert.equal(r.excluded[0].reason, 'channel_not_in_owner_allowlist');
  }
});
check('dedupe title/year across channels and preserve provenance; derivative preferred', () => {
  const r = buildCatalog([row, { ...row, identifier: 'SYNTHETIC_TWO', channelId: 'owner-two', file: 'Film.ia.mp4', title: 'My Film 1940 720p' }], true, allowed);
  assert.equal(r.catalog.assets.length, 1); assert.match(r.catalog.assets[0].archivePath, /Film.ia.mp4$/);
  assert.deepEqual(r.catalog.assets[0].sources, ['owner', 'owner-two']);
});
check('known year and missing-year fallback; numeric film names retained', () => {
  assert.equal(movieIdentity('My Film (1940)', undefined, 'id', 'x'), 'movie:my-film:1940');
  assert.equal(movieIdentity('My Film', undefined, 'id', 'x'), 'movie:id:x');
  assert.equal(movieIdentity('1984 (1956)', 1956, 'id', 'x'), 'movie:1984:1956');
  assert.equal(movieIdentity('2001 A Space Odyssey (1968)', 1968, 'id', 'x'), 'movie:2001-a-space-odyssey:1968');
  assert.equal(movieIdentity('Movie 001', 1940, 'id', 'x'), null);
});
check('clean episode titles prefer decoded file names, never alter archive paths', () => {
  assert.equal(episodeDisplayTitle('Series 1/01%20View%20from%20the%20Villa.mp4', 'Danger Man Destination Danger 63'), 'View from the Villa');
  assert.equal(episodeDisplayTitle('Benson%20-%20S01E01.ia.mp4', 'Benson - S01E01 ia'), 'Benson S01E01');
  assert.equal(episodeDisplayTitle('Hogans%20Heroes%20s1e01.mp4', 'Hogans Heroes 1'), 'Hogans Heroes s1e01');
  assert.equal(episodeDisplayTitle('Get%20Smart%20S01E01%20%28Mr.%20Big%29.ia.mp4', 'legacy'), 'Get Smart S01E01 (Mr Big)');
  assert.equal(episodeDisplayTitle('Taxi%201x01%20Like%20Father%20Like%20Daughter.mp4', 'legacy'), 'Taxi 1x01 Like Father Like Daughter');
  assert.equal(episodeDisplayTitle('001.%20The%20Dick%20Van%20Dyke%20Show%20S01E01.ia.mp4', 'legacy'), 'The Dick Van Dyke Show S01E01');
  assert.equal(episodeDisplayTitle('bad%ZZ.mp4', 'fallback'), 'bad%ZZ');
});
check('serial/episode and explicitly labelled trailers/shorts rejected', () => {
  for (const extra of [{ file: 'S01E02.mp4' }, { file: 'Chapter 01.mp4' }, { kind: 'short' }, { kind: 'trailer' }, { title: 'Film (trailer)' }]) {
    assert.equal(buildCatalog([{ ...row, ...extra }], true, allowed).excluded[0].reason, 'short_trailer_or_serial');
  }
});
check('1968 Odd Couple film flagged, not silently dropped as an episode', () => {
  const r = buildCatalog([{ ...row, title: 'The Odd Couple (1968)', year: 1968, file: 'The Odd Couple 1968.mp4' }], true, allowed);
  assert.equal(r.catalog.assets.length, 1); assert.equal(r.reviewFlags.length, 1);
});
check('29-row vault adapter never invents durations', () => {
  const rows = movieVaultRows([{ identifier: 'SYNTHETIC', title: 'Film', files: [{ name: 'Film.mp4', size: 123 }] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].durationSeconds, undefined);
  assert.equal(buildCatalog(rows, true, ['classic-cinema']).excluded[0].reason, 'missing_real_duration');
});
const assets = Array.from({ length: 200 }, (_, i) => ({ episodeKey: `movie:fixture-${i}:1940`, assetId: `SYNTHETIC-${i}`, title: `SYNTHETIC ${i}`,
  show: 'movies', durationSeconds: 3600, archivePath: `/download/SYNTHETIC/${i}.mp4`, sources: ['owner'] }));
check('SHA256(seed+movieKey) order deterministic, input-order independent, seed-sensitive', () => {
  const a = orderMovies(assets, 'seed');
  assert.deepEqual(a, orderMovies([...assets].reverse(), 'seed')); assert.notDeepEqual(a, orderMovies(assets, 'other'));
  const hashes = a.map(v => createHash('sha256').update('seed' + v.episodeKey).digest('hex'));
  assert.deepEqual(hashes, [...hashes].sort()); assert.equal(assets[0].episodeKey, 'movie:fixture-0:1940');
});
check('full cycle strictly greater than 168 hours', () => {
  assert.throws(() => assertMovieCycle(assets.slice(0, 168)));
  assert.equal(assertMovieCycle(assets.slice(0, 169)), 169 * 3600);
});
check('one pool walks every film before wrapping; 168-hour gate holds', () => {
  const n: NetworkConfig = { id: 'classic-movies', name: 'SYNTHETIC', guideId: 'movies-classics-vault', owner: 'banamine', catalogRef: 'fixture',
    pools: { cinema: { series: ['movies'], rotateEveryWeeks: 1, offset: 0 } }, lineup: [{ start: '00:00', end: '24:00', pool: 'cinema' }] };
  const settings: NetworkSettings = { stationZone: 'America/Los_Angeles', originMonday: '2026-11-09', activeFrom: '2026-11-09T08:00:00Z',
    horizonDays: 20, repeatGapHours: 168, networks: { 'classic-movies': n } };
  const p = compileNetwork(settings, n, { schema: 1, assets });
  assert.equal(new Set(p.programs.slice(0, 200).map(v => v.metadata?.episodeKey)).size, 200);
  assert.equal(p.programs[200].metadata?.episodeKey, p.programs[0].metadata?.episodeKey);
  assert.equal(Date.parse(p.programs[200].startTimeUtc!) - Date.parse(p.programs[0].startTimeUtc!), 200 * HOUR);
});
console.log(`CLASSIC_MOVIES_NETWORK_PASS cases=${cases} (SYNTHETIC offline fixtures)`);
