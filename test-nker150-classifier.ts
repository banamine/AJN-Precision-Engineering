import assert from 'node:assert/strict';
import { classifyShow } from './tools/nker150/classify';

const cases = [
  [{ identifier: 'infowars_202103', title: '', creator: '' }, 'alex-jones-show', false],
  [{ identifier: 'alex-jones-december-2020', title: '', creator: '' }, 'alex-jones-show', false],
  [{ identifier: 'x', title: 'David Knight Evening News', creator: '' }, 'david-knight', false],
  [{ identifier: 'x', title: 'Nightly News', creator: 'Infowars' }, 'infowars-nightly-news', false],
  [{ identifier: 'x', title: 'War Room', creator: 'Infowars / Harrison Smith' }, 'ajn-war-room', false],
  [{ identifier: 'x', title: 'War Room', creator: 'Bannon' }, 'documentaries', true],
  [{ identifier: 'x', title: 'Election debate town hall', creator: '' }, 'elections-debates', false],
  [{ identifier: 'january-6-protest-videos', title: '', creator: '' }, 'january-6', false],
  [{ identifier: 'loose_change_se_bb', title: '', creator: '' }, '9-11', false],
  [{ identifier: 'jre-838-1094', title: '', creator: '' }, 'interviews', false],
  [{ identifier: 'unmatched-archive-item', title: 'Unsorted', creator: 'Unknown' }, 'documentaries', true],
] as const;

for (const [item, expectedId, expectedUnclassified] of cases) {
  const actual = classifyShow(item);
  assert.equal(actual.showId, expectedId);
  assert.equal(actual.unclassified, expectedUnclassified);
}
console.log(`PASS nker150 show classification: ${cases.length} cases`);
