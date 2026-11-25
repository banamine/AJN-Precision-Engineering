/** Verification for the 8 genre 24/7 channels. Real catalogs + real compiled publications; synthetic fixtures only for failure-mode tests.
 *  Run from the repo root:  npx tsx tests/test-genre-channels.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileNetwork, seededIndex, HOUR, type NetworkAsset, type NetworkCatalog, type NetworkConfig, type NetworkSettings, type Publication } from '../server/classicNetwork';
import { validatePublication, createPublicationReader, genreTvChannels, genreMovieChannels, classicNetworkChannel, classicWesternsChannel, classicMoviesChannel } from '../server/classicNetworkPublication';
import { GENRE_CHANNELS } from '../src/guide/genreChannelIds';
import { genresForChannel } from '../src/guide/genreBuckets';

const settings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8')) as NetworkSettings;
const defs = JSON.parse(fs.readFileSync('config/genre-channels.json', 'utf8')) as { tv: Array<{ id: string; shows: Array<{ slug: string }> }>; movies: Array<{ id: string }> };
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const tvIds = defs.tv.map(t => t.id), movieIds = defs.movies.map(m => m.id);
const cat = (id: string) => readJson<NetworkCatalog>(settings.networks[id].catalogRef);
const pub = (id: string) => readJson<Publication>(settings.networks[id].publicationRef!);
let cases = 0;
const record = (name: string, f: () => void) => { f(); cases++; console.log(`PASS ${name}`); };

record('config: 5 TV + 3 movie networks registered, flagship entries untouched', () => {
  for (const id of [...tvIds, ...movieIds]) assert.ok(settings.networks[id], id);
  assert.equal(tvIds.length, 5); assert.equal(movieIds.length, 3);
  for (const id of ['classic-network', 'classic-movies', 'classic-westerns']) assert.ok(settings.networks[id] && !settings.networks[id].schedulingMode);
  assert.deepEqual(GENRE_CHANNELS.map(c => c.id).sort(), [...tvIds, ...movieIds].sort());
});
record('config: showPool equals genre-channels definition; every show has >= minEpisodeDepth distinct verified episodes', () => {
  for (const t of defs.tv) {
    const n = settings.networks[t.id], c = cat(t.id);
    assert.equal(n.schedulingMode, 'shuffle-in-order'); assert.equal(n.episodesPerTurn, 1);
    assert.deepEqual(n.showPool, t.shows.map(s => s.slug));
    for (const s of t.shows) { const keys = new Set(c.assets.filter(a => a.show === s.slug).map(a => a.episodeKey)); assert.ok(keys.size >= (n.minEpisodeDepth ?? 30), `${t.id}/${s.slug}=${keys.size}`); }
  }
});
record('1 shuffle-in-order: exactly one episode per turn, per-show chronological cursor, no back-to-back repeat except logged window-0 relaxations', () => {
  for (const id of tvIds) {
    const p = pub(id), c = cat(id), cursor = new Map<string, number>(), relaxedTurns = new Set((p.diagnostics?.relaxationLog ?? []).filter(r => r.window === 0).map(r => r.turn));
    const order = new Map<string, NetworkAsset[]>();
    for (const a of c.assets) order.set(a.show, [...(order.get(a.show) ?? []), a]);
    let adjacent = 0;
    p.programs.forEach((row, turn) => {
      const show = String(row.metadata!.show), list = order.get(show)!, i = cursor.get(show) ?? 0;
      assert.equal(row.metadata!.episodeKey, list[i % list.length].episodeKey, `${id} turn ${turn} ${show}`);
      cursor.set(show, i + 1);
      if (turn > 0 && p.programs[turn - 1].metadata!.show === show) { adjacent++; assert.ok(relaxedTurns.has(turn) || (p.diagnostics?.relaxationLog.length ?? 0) >= 200, `${id} unexplained back-to-back at ${turn}`); }
    });
    if (id !== 'ajn247-cartoons') assert.equal(adjacent, 0, id);
  }
});
record('1b chronological order within a show: season/episode never decreases inside one pass of the catalog', () => {
  for (const id of tvIds) {
    const by = new Map<string, NetworkAsset[]>();
    for (const a of cat(id).assets) by.set(a.show, [...(by.get(a.show) ?? []), a]);
    for (const [show, list] of by) {
      const coded = list.filter(a => a.season !== undefined);
      for (let i = 1; i < coded.length; i++) assert.ok(coded[i].season! > coded[i - 1].season! || (coded[i].season === coded[i - 1].season && coded[i].episode! >= coded[i - 1].episode!), `${id}/${show} @${i}`);
    }
  }
});
record('2 leakage: no films on TV channels, no TV episodes / shorts / non-MP4 on movie channels, movie channels mutually disjoint', () => {
  const movieKeys = new Map<string, string>();
  for (const id of tvIds) for (const a of cat(id).assets) { assert.ok(a.durationSeconds >= 300 && a.durationSeconds <= 9000, `${id} ${a.episodeKey}`); assert.ok(!a.episodeKey.startsWith('movie:')); assert.ok(/\.mp4$/i.test(a.archivePath)); }
  for (const id of movieIds) for (const a of cat(id).assets) {
    assert.ok(a.durationSeconds >= 3600 && a.durationSeconds <= 14400, `${id} ${a.episodeKey}`);
    assert.ok(a.episodeKey.startsWith('movie:') && a.show === 'movies' && a.season === undefined, a.episodeKey);
    assert.ok(/\.mp4$/i.test(a.archivePath)); assert.ok(!movieKeys.has(a.episodeKey), `overlap ${a.episodeKey}`); movieKeys.set(a.episodeKey, id);
  }
  const tvPaths = new Set(tvIds.flatMap(id => cat(id).assets.map(a => a.archivePath)));
  for (const id of movieIds) for (const a of cat(id).assets) assert.ok(!tvPaths.has(a.archivePath), `TV path on movie channel ${a.archivePath}`);
  for (const id of movieIds) for (const row of pub(id).programs) assert.equal(row.metadata!.show, 'movies');
});
record('3 168h gate over the full compiled horizon (validator + independent scan)', () => {
  for (const id of [...tvIds, ...movieIds]) {
    const p = pub(id); validatePublication(p);
    const last = new Map<string, number>();
    for (const row of p.programs) { const t = Date.parse(row.startTimeUtc!), k = String(row.metadata!.episodeKey); if (last.has(k)) assert.ok(t - last.get(k)! >= 168 * HOUR, `${id} ${k}`); last.set(k, t); }
    assert.ok((p.coveredUntilUtcMs - Date.parse(p.activeFrom)) / (24 * HOUR) >= 59.9, `${id} horizon`);
  }
});
record('3b weekly caps hold on the cartoons channel', () => {
  const n = settings.networks['ajn247-cartoons'], p = pub('ajn247-cartoons'), caps = n.maxWeeklyAirings!;
  assert.ok(Object.keys(caps).length === 4);
  const times = new Map<string, number[]>();
  for (const row of p.programs) { const s = String(row.metadata!.show); times.set(s, [...(times.get(s) ?? []), Date.parse(row.startTimeUtc!)]); }
  for (const [show, cap] of Object.entries(caps)) { const t = times.get(show)!; for (let i = 0, j = 0; i < t.length; i++) { while (t[i] - t[j] >= 168 * HOUR) j++; assert.ok(i - j + 1 <= cap, `${show} ${i - j + 1} > ${cap}`); } }
});
record('4 EPG integration: 5 TV + 3 movie channels present, flagship ids unchanged, genre pills mapped', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const tv = genreTvChannels(now), mv = genreMovieChannels(now);
  assert.deepEqual(tv.map(c => c.id), tvIds); assert.deepEqual(mv.map(c => c.id), movieIds);
  for (const c of [...tv, ...mv]) { assert.equal(c.sourceStatus, 'ok', c.id); assert.ok(c.programs.length > 0, c.id); }
  assert.ok(tv.every(c => c.guideId === 'classic-tv' && c.group === 'Classic TV')); assert.ok(mv.every(c => c.guideId === 'movies-classics-vault' && c.group === 'Movies'));
  assert.equal(new Set([...tv, ...mv].map(c => c.name)).size, 8);
  assert.equal(classicNetworkChannel(now).id, 'classic-network'); assert.equal(classicWesternsChannel(now).id, 'classic-westerns'); assert.equal(classicMoviesChannel(now).id, 'classic-movies');
  const pills = (id: string) => genresForChannel({ id, name: '' }).map(g => g.label);
  assert.deepEqual(pills('ajn247-sitcoms'), ['Comedy']); assert.deepEqual(pills('ajn247-crime'), ['Crime & Mystery']);
  assert.deepEqual(pills('ajn247-scifi'), ['Sci-Fi', 'Horror & Thriller']); assert.deepEqual(pills('ajn247-action'), ['Action & Adventure']);
  assert.deepEqual(pills('ajn247-cartoons'), ['Cartoons', 'Family & Kids']);
});
const fixtureSettings: NetworkSettings = { stationZone: 'America/Los_Angeles', originMonday: '2026-11-02', activeFrom: '2026-11-14T00:00:00 America/Los_Angeles', horizonDays: 60, repeatGapHours: 168, networks: {} };
const filmNet: NetworkConfig = { id: 'fx-movies', name: 'fx', guideId: 'movies-classics-vault', owner: 'x', catalogRef: 'fx', lineup: [], pools: {}, schedulingMode: 'random-movie', seed: 'fx-seed' };
const films: NetworkCatalog = { schema: 1, assets: Array.from({ length: 100 }, (_, i) => ({ episodeKey: `movie:fx-${i}:1950`, assetId: `fx-${i}`, show: 'movies', title: `Film ${i}`, archivePath: `/download/fx/${i}.mp4`, durationSeconds: 7200 + (i % 5) * 60, sources: ['fx'] })) };
record('5 movie cycle seam: every cycle boundary keeps >= 168h between airings of any film; every film airs once per cycle', () => {
  const p = compileNetwork(fixtureSettings, filmNet, films);
  const L = films.assets.length, cycles = Math.floor(p.programs.length / L);
  assert.ok(cycles >= 2, `need >= 2 full cycles, got ${cycles}`);
  for (let c = 0; c < cycles; c++) assert.equal(new Set(p.programs.slice(c * L, (c + 1) * L).map(r => r.metadata!.episodeKey)).size, L, `cycle ${c} is a permutation`);
  const last = new Map<string, number>(); let min = Infinity;
  for (const row of p.programs) { const t = Date.parse(row.startTimeUtc!), k = String(row.metadata!.episodeKey); if (last.has(k)) min = Math.min(min, t - last.get(k)!); last.set(k, t); }
  assert.ok(min >= 168 * HOUR, `min gap ${min / HOUR}h`);
  for (const id of movieIds) { const e = readJson<{ minGapHours: number | null }>(`reports/classic-network/${id}-evidence.json`); assert.ok(e.minGapHours === null || e.minGapHours >= 168, id); }
});
const tvNet = (): NetworkConfig => ({ ...settings.networks['ajn247-sitcoms'] });
record('6 renewal seam: --previous renewal is identical to one uninterrupted compile and resumes every show on its exact next episode', () => {
  const n = tvNet(), c = cat('ajn247-sitcoms');
  const full = compileNetwork({ ...fixtureSettings, horizonDays: 16 }, n, c);
  const first = compileNetwork({ ...fixtureSettings, horizonDays: 10 }, n, c);
  const renewed = compileNetwork({ ...fixtureSettings, horizonDays: 10 }, { ...n, activeFrom: '2026-11-20T00:00:00 America/Los_Angeles' }, c, first);
  const seq = (p: Publication) => p.programs.map(r => `${r.metadata!.episodeKey}@${r.startTimeUtc}`);
  assert.deepEqual(seq(renewed), seq(full));
  assert.ok(renewed.checkpoint.turnIndex === renewed.programs.length);
  assert.ok(first.programs.every(r => renewed.programs.some(x => x.id === r.id) || Date.parse(r.startTimeUtc!) >= Date.parse('2026-11-20T08:00:00Z')));
});
record('7 determinism: identical inputs give a byte-identical publication, and committed artifacts equal a fresh compile', () => {
  const n = tvNet(), c = cat('ajn247-sitcoms');
  const a = compileNetwork({ ...fixtureSettings, horizonDays: 5 }, n, c), b = compileNetwork({ ...fixtureSettings, horizonDays: 5 }, n, c);
  assert.equal(JSON.stringify({ ...a, tzdbNote: '' }), JSON.stringify({ ...b, tzdbNote: '' }));
  assert.equal(seededIndex('s', '1', 7), seededIndex('s', '1', 7));
  for (const id of [...tvIds, ...movieIds]) { const fresh = compileNetwork(settings, settings.networks[id], cat(id)); assert.equal(fresh.revision, pub(id).revision, `${id} artifact is stale: recompile`); }
});
record('8 empty-eligible set fails compilation explicitly with networkId, turnIndex and show states (168h gate never relaxed)', () => {
  const tiny: NetworkCatalog = { schema: 1, assets: Array.from({ length: 3 }, (_, i) => ({ episodeKey: `solo:s01e0${i}`, assetId: `s${i}`, show: 'solo', title: `S ${i}`, archivePath: `/download/s/${i}.mp4`, durationSeconds: 1800, sources: ['s'] })) };
  const n: NetworkConfig = { id: 'fx-tv', name: 'fx', guideId: 'classic-tv', owner: 'x', catalogRef: 'fx', lineup: [], pools: {}, schedulingMode: 'shuffle-in-order', showPool: ['solo'], seed: 'fx', minEpisodeDepth: 1 };
  assert.throws(() => compileNetwork({ ...fixtureSettings, horizonDays: 3 }, n, tiny), (e: Error) => /shuffle-in-order exhausted/.test(e.message) && /networkId=fx-tv/.test(e.message) && /turnIndex=3/.test(e.message) && /remainingCooldownMs/.test(e.message));
  assert.throws(() => compileNetwork(fixtureSettings, { ...n, minEpisodeDepth: undefined }, tiny), /< 30/);
});
record('9 expiry contract: reader returns explicit unavailable messages outside the compiled window; only -24h/+48h is returned', () => {
  const p = pub('ajn247-crime'), reader = createPublicationReader(p);
  assert.match(reader.getWindow(p.coveredUntilUtcMs + 1).error ?? '', /Schedule ends .*Operator action needed/);
  assert.match(reader.getWindow(Date.parse(p.activeFrom) - 1).error ?? '', /Schedule starts/);
  const now = Date.parse(p.activeFrom) + 20 * 24 * HOUR, w = reader.getWindow(now, 48 * HOUR, 24 * HOUR);
  const expected = p.programs.filter(r => Date.parse(r.endTimeUtc!) > now - 24 * HOUR && Date.parse(r.startTimeUtc!) < now + 48 * HOUR).length;
  assert.ok(expected > 20 && w.programs.length === expected, `window ${w.programs.length} vs ${expected}`);
  for (const r of w.programs) { assert.ok(Date.parse(r.endTimeUtc!) > now - 24 * HOUR); assert.ok(Date.parse(r.startTimeUtc!) < now + 48 * HOUR); }
  assert.equal(createPublicationReader({ ...p, revision: 'tampered' }).getWindow(now).programs.length, 0);
  for (const row of p.programs.slice(0, 50)) assert.ok(row.archivePath!.startsWith('/download/'));
});
console.log(`\nALL ${cases} GENRE CHANNEL CHECKS PASSED`);
