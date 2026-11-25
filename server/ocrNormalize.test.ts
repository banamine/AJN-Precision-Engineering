import assert from 'node:assert/strict';
import { tier1, normalizeOldText, findSentences } from './ocrNormalize';
assert.equal(tier1('Engliſh ſubjects'), 'English subjects');
assert.equal(tier1('the reso-\nlution passed'), 'the resolution passed');
assert.equal(tier1('ﬁrst ﬂag'), 'first flag');
// Tier 2 repairs only from the document's own vocabulary
const doc = Array(30).fill('the parliament says that the king says so').join('. ') + '. He fays nothing.';
const r = normalizeOldText(doc);
assert.ok(r.text.includes('He says nothing'));
assert.deepEqual(r.repairs.map((x) => x.to), ['says']);
// a rare word with no common neighbour is left alone, never invented
const r2 = normalizeOldText('The colony of Zanzibar sent a letter. The colony wrote back.');
assert.equal(r2.repairs.length, 0);
// sentences are verbatim slices, none invented
const s = findSentences('Hence it is that the groſſeſt abſurdities paſs for irrefragable arguments in the mouth of a popular declaimer, whilſt the cleareſt deductions of reaſon are termed delufive ſophiſtry.');
for (const x of s) assert.ok(('Hence it is that the grossest absurdities pass for irrefragable arguments in the mouth of a popular declaimer, whilst the clearest deductions of reason are termed delufive sophistry.').includes(x.text.replace(/\.$/, '')));
console.log('ocrNormalize tests ok');
const real = normalizeOldText(Array(40).fill('the same fame of the king').join('. ') + ' Fame came late.');
assert.equal(real.repairs.length, 0, 'real words are never changed');
assert.equal(normalizeOldText('what- ever may come. ' + 'whatever '.repeat(3)).text.startsWith('whatever may'), true);
console.log('ocrNormalize extra ok');
