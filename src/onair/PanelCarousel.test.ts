import test from 'node:test';
import assert from 'node:assert/strict';
import { pageText, pickPage, dwellFor, MIN_DWELL_MS, PAGE_CHARS } from './panelCarouselLogic';

test('short text is one page, never cut', () => { assert.deepEqual(pageText('Hello  world'), ['Hello world']); });
test('long text pages keep every word', () => {
  const t = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
  const p = pageText(t);
  assert.ok(p.length > 1 && p.every((x) => x.length <= PAGE_CHARS));
  assert.equal(p.join(' '), t);
});
test('dwell is at least 6 s and grows with length', () => { assert.equal(dwellFor('hi'), MIN_DWELL_MS); assert.equal(dwellFor('x'.repeat(200)), 14000); });
test('pickPage is deterministic and shows each item in turn', () => {
  const items = ['alpha', 'bravo'];
  assert.equal(pickPage(items, 0)!.text, 'alpha');
  assert.equal(pickPage(items, 5999)!.text, 'alpha');
  assert.equal(pickPage(items, 6000)!.text, 'bravo');
  assert.equal(pickPage(items, 12000)!.text, 'alpha');
  assert.equal(pickPage(items, 6000)!.n, 2);
});
test('empty list renders nothing', () => { assert.equal(pickPage([], 1), null); assert.equal(pickPage(['  '], 1), null); });
