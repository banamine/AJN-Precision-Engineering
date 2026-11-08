import assert from 'node:assert/strict';
import { buildZipmemberManifests, zipmemberManifests, ZIPMEMBER_SERIES } from './collections/zipmember-series';
const A = 'https://archive.org/download/';
const good = (id: string, f: string, d: number) => ({ url: `${A}${id}/${f}`, durationSec: d, bytes: 1000, source: 'x' });
// 1) shipped data file is empty -> no channels
assert.deepEqual(zipmemberManifests(), {}, 'empty data -> no manifests');
assert.equal(ZIPMEMBER_SERIES.length, 4);
// 2) one real-shaped entry appears with EXACTLY its duration
const one = buildZipmemberManifests([good('stargate-atlantis-s05-2008-eng-cc1-captions-faststart', 'Stargate_Atlantis_S05E01_Eng_cc1.mp4', 2617.088)]);
assert.deepEqual(Object.keys(one), ['sc-stargate-atlantis']);
const e = one['sc-stargate-atlantis'].episodes[0];
assert.equal(e.season, 5); assert.equal(e.episode, 1); assert.equal(e.durationSeconds, 2617); assert.equal(e.durationEstimated, false);
assert.equal(e.path, '/download/stargate-atlantis-s05-2008-eng-cc1-captions-faststart/Stargate_Atlantis_S05E01_Eng_cc1.mp4');
assert.equal(e.title, 'Episode 1');
// 3) refused: zip-member url, missing/zero/NaN duration, unknown show, non-mp4, http, no S/E in name
const bad = buildZipmemberManifests([
  { url: `${A}stargate-atlantis-s05-2008-eng-cc1-captions/Stargate%20Atlantis%20S05E01-05%20cc1.zip/Stargate%20Atlantis%20S05E01%20Eng%20cc1.mp4`, durationSec: 2600 },
  good('stargate-atlantis-s01-x', 'a_S01E01.mp4', 0), { url: `${A}stargate-atlantis-s01-x/a_S01E02.mp4` },
  good('stargate-atlantis-s01-x', 'a_S01E03.mp4', NaN as number), good('some-other-show', 'a_S01E01.mp4', 2000),
  good('stargate-atlantis-s01-x', 'a_S01E04.mkv', 2000), { url: 'http://archive.org/download/stargate-atlantis-s01-x/a_S01E05.mp4', durationSec: 2000 },
  null, 'junk', 7,
]);
assert.deepEqual(bad, {}, 'nothing invalid may become an episode');
assert.deepEqual(buildZipmemberManifests(undefined), {}); assert.deepEqual(buildZipmemberManifests({}), {});
// 4) ordering, pairs, duplicates, titles, all four shows
const many = buildZipmemberManifests([
  good('star-trek-ds9-1993-s01-eng-cc1-captions-faststart', 'Star_Trek_DS9_S01E03_Eng_cc2_Captions.mp4', 2700),
  good('star-trek-ds9-1993-s01-eng-cc1-captions-faststart', 'Star_Trek_DS9_S01E01-02_Eng_cc2_Captions.mp4', 5400),
  good('star-trek-ds9-1993-s01-eng-cc1-captions-faststart', 'Star_Trek_DS9_S01E03_Eng_cc2_Captions.mp4', 9999),
  good('babylon-5-S01-1994-eng-cc1-captions-for-deaf-and-hearing-impaired-faststart', 'Babylon_5_S01E01_Eng_cc1_Captions.mp4', 2640),
  good('marvels-agents-of-shield-s02-2014-eng-cc1-captions-faststart', 'MAOS_S02E01_Eng_cc1.mp4', 2500),
]);
assert.deepEqual(Object.keys(many).sort(), ['sc-agents-of-shield', 'sc-babylon-5', 'sc-star-trek-ds9']);
const ds9 = many['sc-star-trek-ds9'].episodes;
assert.deepEqual(ds9.map((x) => `${x.season}x${x.episode}`), ['1x1', '1x3']);
assert.equal(ds9[0].title, 'Episodes 1-2'); assert.equal(ds9[0].durationSeconds, 5400); assert.equal(ds9[1].durationSeconds, 2700, 'first duplicate wins');
assert.ok(many['sc-star-trek-ds9'].issues.some((s) => s.includes('listed twice')));
assert.equal(many['sc-star-trek-ds9'].seasons[0].missing.join(','), '2');
console.log('zipmember-series: all assertions passed');
