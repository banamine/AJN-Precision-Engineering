import assert from 'node:assert/strict';
import { decodeField, tokenizeAndStripHtml } from './decode';
import { parseArticleUrl, parseImageUrl } from './url';
import { classifyDate } from './date';
import { normalizeRaw, normalizeBatch, readNormalized } from './normalize';
import type { SourceConfig } from './types';

const cfg: SourceConfig = {
  sourceId: 'test',
  fields: { title: { format: 'multi-encoded' }, summary: { format: 'multi-encoded', markup: true } },
  trackingParams: ['utm_source'],
};
let n = 0;
const t = (name: string, fn: () => void): void => { fn(); n++; console.log(`ok ${n} - ${name}`); };
const multi = { format: 'multi-encoded' as const };

// Fixtures copied from test-news-digest.ts:7 (real double-encoded strings).
t('real fixture: title double-encoded', () => {
  assert.equal(decodeField(String.raw`Kyiv &amp;amp; bridge`, multi).text, 'Kyiv & bridge');
});
t('real fixture: summary double-encoded with markup', () => {
  const r = decodeField(String.raw`An &amp;amp; excerpt <b>with</b> markup`, { ...multi, markup: true });
  assert.equal(r.text, 'An & excerpt with markup');
});
t('named entities from newsDigest NAMED set', () => {
  assert.equal(decodeField('a&nbsp;b &ndash; &mdash; &hellip; &lsquo;x&rsquo; &ldquo;y&rdquo; &apos;', multi).text, 'a b – — … ‘x’ “y” \'');
});
t('numeric C1 refs map via Windows-1252', () => {
  assert.equal(decodeField('it&#146;s &#150;&#151; &#128;', multi).text, 'it’s –— €');
});
t('&#0; stays literal with diagnostic', () => {
  const r = decodeField('a&#0;b', multi);
  assert.equal(r.text, 'a&#0;b');
  assert.ok(r.diagnostics.some((d) => d.code === 'disallowed-codepoint'));
});
t('no false unknown-entity on leftover &amp;', () => {
  const r = decodeField('x &amp;amp; y', multi);
  assert.equal(r.diagnostics.length, 0);
});
t('unknown entity reported, kept literal', () => {
  const r = decodeField('&myCustomUnknown;', multi);
  assert.equal(r.text, '&myCustomUnknown;');
  assert.ok(r.diagnostics.some((d) => d.code === 'unknown-entity'));
});
t('5-level encoding withheld at limit', () => {
  const r = decodeField('&amp;amp;amp;amp;amp;', multi);
  assert.equal(r.text, null);
  assert.equal(r.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'normalization-limit'));
});
t('4-level encoding fully decoded', () => {
  assert.equal(decodeField('&amp;amp;amp;lt;', multi).text, '<');
});
t('plain is not decoded unless escaped', () => {
  assert.equal(decodeField('AT&amp;T', { format: 'plain' }).text, 'AT&amp;T');
  assert.equal(decodeField('AT&amp;T', { format: 'plain', escaped: true }).text, 'AT&T');
});
t('html tokenizer: stray <, script, comments, attributes', () => {
  assert.equal(tokenizeAndStripHtml('5 < 10 <3'), '5 < 10 <3');
  assert.equal(tokenizeAndStripHtml('a<script>x<b>y</script>b').replace(/\s+/g, ' '), 'a b');
  assert.equal(tokenizeAndStripHtml('a<!-- c -->b').replace(/\s+/g, ''), 'ab');
  assert.equal(tokenizeAndStripHtml('<a href="x>y">t</a>'), 't');
});
t('oversized and non-string input', () => {
  assert.equal(decodeField('a'.repeat(20001), multi).text, null);
  assert.equal(decodeField({}, multi).text, null);
});
t('article URL: http allowed, not rewritten; creds/scheme rejected', () => {
  const a = parseArticleUrl('http://example.com/a');
  assert.ok(a.ok && a.url.startsWith('http://'));
  assert.equal(parseArticleUrl('https://u:p@example.com/').ok, false);
  assert.equal(parseArticleUrl('javascript:alert(1)').ok, false);
  assert.equal(parseArticleUrl('').ok, false);
});
t('image URL: https only', () => {
  assert.equal(parseImageUrl('http://e.com/i.png'), null);
  assert.equal(parseImageUrl('https://e.com/i.png'), 'https://e.com/i.png');
  assert.equal(parseImageUrl('https://u:p@e.com/i.png'), null);
});
t('dates: zone-less is ambiguous, never local-parsed', () => {
  assert.equal(classifyDate('2026-11-07 10:00:00').status, 'ambiguous');
  assert.equal(classifyDate('2026-11-07T10:00:00Z').iso, '2026-11-07T10:00:00.000Z');
  assert.equal(classifyDate('Sat, 07 Nov 2026 10:00:00 GMT').status, 'valid');
  assert.equal(classifyDate('2026-11-07T10:00:00+02:00').iso, '2026-11-07T08:00:00.000Z');
  assert.equal(classifyDate('nope').status, 'malformed');
  assert.equal(classifyDate(undefined).status, 'missing');
});
t('normalizeRaw: undated retained, dates kept separate, raw preserved', () => {
  const raw = { title: 'Kyiv &amp;amp; bridge', url: 'http://e.com/a?utm_source=x', fetchedAt: '2026-11-07T10:00:00Z' };
  const r = normalizeRaw(raw, cfg);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.item.title, 'Kyiv & bridge');
  assert.equal(r.item.publishedAt, null);
  assert.equal(r.item.dateStatus, 'missing');
  assert.equal(r.item.fetchedAt, '2026-11-07T10:00:00.000Z');
  assert.equal(r.item.raw.title, 'Kyiv &amp;amp; bridge');
  assert.equal(r.item.urlKey, 'http://e.com/a');
  assert.ok(r.item.articleUrl.includes('utm_source'));
});
t('normalizeRaw throws on normalized input; readNormalized never decodes', () => {
  const r = normalizeRaw({ title: 'A &amp; B', url: 'https://e.com/x' }, cfg);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.throws(() => normalizeRaw(r.item as never, cfg));
  assert.equal(readNormalized(r.item).title, 'A & B');
  assert.throws(() => readNormalized({ title: 'x' }));
});
t('batch: bad url rejected, empty/limit title withheld', () => {
  const b = normalizeBatch(
    [
      { title: 'ok', url: 'https://e.com/1' },
      { title: 'bad', url: 'ftp://e.com/2' },
      { title: '&amp;amp;amp;amp;amp;', url: 'https://e.com/3' },
      { title: '', url: 'https://e.com/4' },
    ],
    cfg
  );
  assert.deepEqual(b.counts, { total: 4, valid: 1, withheld: 2, rejected: 1 });
});
t('title zone label is diagnostic only', () => {
  const r = normalizeRaw({ title: 'Live 10:00 TST', url: 'https://e.com/z' }, cfg);
  assert.ok(r.ok && r.item.diagnostics.some((d) => d.code === 'title-zone-label'));
});
console.log(`${n} tests passed`);
