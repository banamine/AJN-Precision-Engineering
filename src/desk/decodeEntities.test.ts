import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, decodeDeskItem } from './decodeEntities';

test('decodes numeric and named codes, leaves plain text and unknown codes alone', () => {
  assert.equal(decodeEntities('The Oil War&#039; and &#039;the Arabs&#039; Grand Slam,'), "The Oil War' and 'the Arabs' Grand Slam,");
  assert.equal(decodeEntities('AT&amp;T &quot;memo&quot; &#x27;x&#x27;'), 'AT&T "memo" \'x\'');
  assert.equal(decodeEntities('plain text, 5 < 6'), 'plain text, 5 < 6');
  assert.equal(decodeEntities('&unknown; &#0; &#99999999;'), '&unknown; &#0; &#99999999;');
  assert.equal(decodeEntities('&amp;#039;'), '&#039;', 'decoded once only');
  assert.equal(decodeEntities(''), '');
});
test('decodeDeskItem decodes headline, lead, source, excerpt and keeps the rest', () => {
  const it = decodeDeskItem({ id: 'a', headline: 'It&#039;s', lead: 'A &amp; B', source: 'CIA &amp; Co', excerpt: null, year: 1983 });
  assert.deepEqual([it.headline, it.lead, it.source, it.excerpt, it.id, it.year], ["It's", 'A & B', 'CIA & Co', null, 'a', 1983]);
});
