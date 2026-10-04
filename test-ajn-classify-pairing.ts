// Regression: AJN filename classification (Radio vs Exclusive) and hourly audio<->video pairing.
import assert from 'node:assert/strict';
import { classifyAjnMedia, channelFor, fileKeyOf, formatAirDate } from './src/utils/ajnClassify.ts';
import { pairAjnMedia } from './src/utils/ajnPairing.ts';

const A = 'https://archive.alexjoneslive.com/hourly-mp3/';
const V = 'https://archive.alexjoneslive.com/hourly-m4v/';

// --- classification
const hour = classifyAjnMedia({ url: `${A}20261002_Fri_WarRoom-Hr3.mp3`, title: 'War Room 2026-Oct-02 Friday' });
assert.deepEqual([hour.showSlug, hour.showType, hour.airDate, hour.hourNumber, hour.variant, hour.kind], ['war-room', 'hour', '2026-10-02', 3, null, 'audio']);
assert.equal(hour.cleanTitle, 'War Room — Hour 3 — Fri Oct 2, 2026');
assert.equal(hour.needsReview, false);
assert.equal(channelFor(hour), 'ajn-radio');

const special = classifyAjnMedia({ url: `${A}20260926_Sat_Alex-Special.mp3` });
assert.deepEqual([special.showType, special.variant], ['special', 'Special']);
assert.equal(special.cleanTitle, 'Alex Jones Special — Sat Sep 26, 2026');
assert.equal(channelFor(special), 'ajn-exclusive');
assert.equal(channelFor(special, ['Other']), 'ajn-radio', 'exclusive membership is configuration');

const full = classifyAjnMedia({ url: `${A}20261002_Fri_Alex.mp3` });
assert.equal(full.showType, 'full_show');
assert.equal(classifyAjnMedia({ url: `${V}20261002_Fri_Alex-Hr1.m4v` }).kind, 'video');

// never guess dates
assert.ok(classifyAjnMedia({ url: `${A}20261002_Mon_Alex.mp3` }).reviewReasons.includes('weekday_mismatch'));
assert.equal(classifyAjnMedia({ url: `${A}20261002_Mon_Alex.mp3` }).airDate, null);
assert.ok(classifyAjnMedia({ url: `${A}20261302_Fri_Alex.mp3` }).reviewReasons.includes('invalid_filename_date'));
assert.ok(classifyAjnMedia({ url: `${A}20261002_Fri_Alex-Weird.mp3` }).reviewReasons.includes('unknown_variant'));
assert.deepEqual(classifyAjnMedia({ url: `${A}random.mp3` }).reviewReasons, ['unrecognized_filename']);
assert.ok(classifyAjnMedia({ url: `${A}20261002_Fri_Alex.mp3`, title: 'Alex Jones 2026-Oct-01 Thursday' }).reviewReasons.includes('title_filename_date_mismatch'));
assert.ok(classifyAjnMedia({ url: `${A}20261002_Fri_Alex.mp3`, title: 'War Room 2026-Oct-02 Friday' }).reviewReasons.includes('title_filename_show_mismatch'));
assert.equal(classifyAjnMedia({ url: 'not a url' }).needsReview, true);
assert.equal(fileKeyOf(`${A}20261002_Fri_WarRoom-Hr3.mp3`), '20261002_Fri_WarRoom-Hr3');
assert.equal(formatAirDate('2026-10-02'), 'Fri Oct 2, 2026');

// --- pairing
const audio = [
  { url: `${A}20261002_Fri_Alex-Hr1.mp3` },
  { url: `${A}20261002_Fri_Alex-Hr2.mp3` },
  { url: `${A}20261002_Fri_WarRoom-Hr1.mp3` },
  { url: `${A}20261002_Fri_Alex-Hr3.mp3` },
];
const video = [
  { url: `${V}20261002_Fri_Alex-Hr1.m4v` },                 // identity match for Hr1
  { url: 'https://archive.alexjoneslive.com/other/20261002_Fri_Alex-Hr2.mp4' }, // same file key, different folder/extension -> identity
  { url: `${V}20261002_Fri_Alex-Hr9.m4v` },                 // unrelated
];
let pairs = pairAjnMedia(audio, video);
assert.deepEqual(pairs.map(p => p.matchReason), ['file-key', 'file-key', 'none', 'none']);
assert.equal(pairs[0].video?.url, video[0].url);
assert.equal(pairs[2].video, null);
assert.equal(pairs[3].video, null);

// multi-match is rejected, never guessed
pairs = pairAjnMedia([{ url: `${A}20261002_Fri_Alex-Hr4.mp3` }], [
  { url: `${V}20261002_Fri_Alex-Hr4.m4v` }, { url: `${V}20261002_Fri_Alex-Hr4.mp4` },
]);
// distinct file keys differ only by extension: same key -> two distinct URLs -> ambiguous
assert.equal(pairs[0].matchReason, 'ambiguous');
assert.equal(pairs[0].video, null);

// a query string does not change identity; a variant mismatch must not pair
pairs = pairAjnMedia([{ url: `${A}20261002_Fri_Alex-Hr5.mp3` }], [{ url: `${V}20261002_Fri_Alex-Hr5.m4v?x=1` }]);
assert.equal(pairs[0].matchReason, 'file-key');
pairs = pairAjnMedia([{ url: `${A}20261002_Fri_Alex-Hr5.mp3` }], [{ url: `${V}20261002_Fri_Alex-Hr5-Special.m4v` }]);
assert.equal(pairs[0].matchReason, 'none', 'variant mismatch must not pair');

// date+title fallback needs an exact title and a valid date; otherwise none
pairs = pairAjnMedia([{ url: `${A}20261002_Fri_Alex.mp3`, title: 'Alex Jones 2026-Oct-02 Friday' }], [{ url: `${V}renamed.m4v`, title: 'Alex Jones 2026-Oct-02 Friday' }]);
assert.equal(pairs[0].matchReason, 'none', 'video with unclassifiable filename has no airDate, so title alone is not enough');

// audio that is not classifiable is never paired; videos never pair as audio
assert.equal(pairAjnMedia([{ url: `${A}junk.mp3` }], video)[0].matchReason, 'none');
console.log('ajn classify/pairing regression: all passed');
