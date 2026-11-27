import assert from 'node:assert/strict';
import { HIT_BUCKET_SECONDS, LIMITS, indexCues, matchEpisode, normalizeText, phrasesOf, ruleAppliesTo, sanitizeRules, type AlertRule, type CueLike, type EpisodeRef } from './alertMatch.ts';

const ep: EpisodeRef = { showId: 'show-a', showName: 'Show A', channelId: 'pod-show-a', programId: 'pod-show-a-x1', guid: 'g1', title: 'Ep 1', publishedAt: 1, url: 'https://x/a.mp3', archive: false };
const rule = (over: Partial<AlertRule> & { terms: AlertRule['terms'] }): AlertRule => ({ id: 'r1', name: 'R', enabled: true, scope: { kind: 'all' }, ...over });
const cue = (s: number, t: string, sp?: string): CueLike => ({ s, e: s + 4, t, ...(sp ? { sp } : {}) });

// normalisation
assert.equal(normalizeText("Trump's  Café — Don’t STOP!"), 'trump cafe dont stop');
assert.equal(normalizeText(''), ''); assert.equal(normalizeText(undefined as unknown as string), '');
assert.deepEqual(phrasesOf({ type: 'person', text: 'Joe Biden', aliases: ['Biden', 'J', 'joe biden'] }), ['joe biden', 'biden'], 'dedupes, drops one-letter aliases');

// whole word only
let cues = [cue(0, 'The police arrived at the office.'), cue(5, 'No ice here, only police.')];
let hits = matchEpisode([rule({ terms: [{ type: 'keyword', text: 'ice' }] })], ep, cues);
assert.equal(hits.length, 1, '"ice" hits the word ice, never "police" or "office"');
assert.equal(hits[0].cueIndex, 1);
assert.equal(hits[0].timing, 'clean-show');

// possessive, case, punctuation, alias
cues = [cue(0, "Then TRUMP'S lawyers spoke."), cue(300, 'Mr. Biden, however, left.')];
hits = matchEpisode([rule({ terms: [{ type: 'person', text: 'Donald Trump', aliases: ['Trump'] }, { type: 'person', text: 'Joe Biden', aliases: ['Biden'] }] })], ep, cues);
assert.deepEqual(hits.map((h) => h.cueIndex), [0, 1]);
assert.deepEqual(hits.map((h) => h.term), ['Donald Trump', 'Joe Biden'], 'the canonical term is reported, not the alias');

// a phrase spanning two cues, and across an empty cue
cues = [cue(0, 'We spoke to the secretary of'), cue(3, ''), cue(6, 'state about it.')];
hits = matchEpisode([rule({ terms: [{ type: 'topic', text: 'secretary of state' }] })], ep, cues);
assert.equal(hits.length, 1); assert.equal(hits[0].cueIndex, 0, 'the hit is the cue where the phrase STARTS');
assert.equal(hits[0].cueStart, 0);

// one hit per rule + episode + 120 s bucket; a later bucket is its own hit; two terms in one bucket merge
cues = [cue(10, 'Apple announced it.'), cue(40, 'Apple again.'), cue(70, 'Google too.'), cue(HIT_BUCKET_SECONDS + 10, 'Apple later.'), cue(900, 'Google much later.')];
hits = matchEpisode([rule({ terms: [{ type: 'brand', text: 'Apple' }, { type: 'competitor', text: 'Google' }] })], ep, cues);
assert.equal(hits.length, 3, 'bucket 0 (apple x2 + google), bucket 1 (apple), bucket 7 (google)');
assert.deepEqual(hits[0].matchedTerms.sort(), ['Apple', 'Google'], 'terms in one bucket merge into one alert');
assert.equal(hits[0].cueIndex, 0, 'the earliest cue of the bucket');
assert.equal(new Set(hits.map((h) => h.id)).size, 3, 'hit ids are distinct and stable');
assert.deepEqual(matchEpisode([rule({ terms: [{ type: 'brand', text: 'Apple' }, { type: 'competitor', text: 'Google' }] })], ep, cues).map((h) => h.id), hits.map((h) => h.id), 'stable across runs');

// scope and enabled
const scoped = rule({ scope: { kind: 'shows', showIds: ['other'] }, terms: [{ type: 'keyword', text: 'apple' }] });
assert.equal(ruleAppliesTo(scoped, 'show-a'), false); assert.equal(matchEpisode([scoped], ep, cues).length, 0);
assert.equal(matchEpisode([rule({ enabled: false, terms: [{ type: 'keyword', text: 'apple' }] })], ep, cues).length, 0);
assert.equal(matchEpisode([{ ...scoped, scope: { kind: 'shows', showIds: ['show-a'] } }], ep, cues).length, 2);

// archive flag and speaker + snippet rules
const sp = [cue(0, 'Short.', 'Speaker 1'), cue(5, 'Fed rate cut ahead.', 'Speaker 2')];
hits = matchEpisode([rule({ terms: [{ type: 'topic', text: 'rate cut' }] })], { ...ep, archive: true }, sp);
assert.equal(hits[0].archive, true); assert.equal(hits[0].speaker, 'Speaker 2'); assert.match(hits[0].snippet, /^Short\. Fed rate cut ahead\.$/, 'a short cue gets the line before it');
const long = [cue(0, 'word '.repeat(200) + 'needle ' + 'word '.repeat(50))];
assert.ok(matchEpisode([rule({ terms: [{ type: 'keyword', text: 'needle' }] })], ep, long)[0].snippet.length <= 240, 'snippet is capped');

// nothing to match
assert.deepEqual(matchEpisode([rule({ terms: [{ type: 'keyword', text: 'x1' }] })], ep, []), []);
assert.deepEqual(indexCues([]), { full: '', starts: [] });

// sanitizeRules
assert.deepEqual(sanitizeRules('nope'), []); assert.deepEqual(sanitizeRules(null), []);
const messy = sanitizeRules([
  { id: 'a', name: '  Good  ', terms: [{ type: 'bogus', text: 'Hello there', aliases: ['x', 'Hi there', 5] }] },
  { id: 'a', name: 'dup id', terms: [{ type: 'keyword', text: 'dup' }] },
  { id: 'b', name: '', terms: [{ type: 'keyword', text: 'noname' }] },
  { id: 'c', name: 'No terms', terms: [{ type: 'keyword', text: 'x' }] },
  { id: 'd', name: 'Empty shows', scope: { kind: 'shows', showIds: [] }, terms: [{ type: 'keyword', text: 'valid' }] },
  { id: 'e', name: 'Shows', enabled: false, scope: { kind: 'shows', showIds: ['s1', ''] }, terms: [{ type: 'brand', text: 'valid' }] },
]);
assert.deepEqual(messy.map((r) => r.id), ['a', 'e']);
assert.equal(messy[0].name, 'Good'); assert.equal(messy[0].terms[0].type, 'keyword', 'unknown type falls back to keyword'); assert.deepEqual(messy[0].terms[0].aliases, ['Hi there'], 'one-letter / non-string aliases dropped');
assert.equal(messy[1].enabled, false); assert.deepEqual(messy[1].scope, { kind: 'shows', showIds: ['s1'] });
const many = sanitizeRules(Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, terms: [{ type: 'keyword', text: 'valid' }] })));
assert.equal(many.length, LIMITS.rules, 'rule count is capped');
console.log('alertMatch tests passed');
