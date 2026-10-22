import assert from 'node:assert/strict';
import { escapeLuceneText, parseBroadcastTitle, tvNewsQueryClause } from './server/tvNewsQuery';

// The exact text that produced "Archive search failed" (HTTP 502) in the owner's screenshot.
const title = 'The Five : FOXNEWSW : October 8, 2026 2:00pm-3:00pm PDT';
const b = parseBroadcastTitle(title);
assert.ok(b);
assert.equal(b.network, 'FOXNEWSW');
assert.equal(b.identifierPrefix, 'FOXNEWSW_20261008_210000_'); // 2pm PDT = 21:00 UTC, verified against archive.org
assert.equal(tvNewsQueryClause(title), 'identifier:FOXNEWSW_20261008_210000_*');

// Evening local time rolls into the next UTC day (real item FOXNEWSW_20261008_040000_The_Five is "October 7, 2026 9:00pm PDT").
assert.equal(parseBroadcastTitle('The Five : FOXNEWSW : October 7, 2026 9:00pm-10:00pm PDT')?.identifierPrefix, 'FOXNEWSW_20261008_040000_');
// Standard time, 12 am / 12 pm edge cases, and a different network/zone.
assert.equal(parseBroadcastTitle('Show : CNN : January 5, 2026 12:00am-1:00am EST')?.identifierPrefix, 'CNN_20260105_050000_');
assert.equal(parseBroadcastTitle('Show : CNN : January 5, 2026 12:00pm-1:00pm PST')?.identifierPrefix, 'CNN_20260105_200000_');
// Unknown zone / month / not a title: never guessed.
assert.equal(parseBroadcastTitle('Show : CNN : January 5, 2026 1:00pm-2:00pm XYZ'), null);
assert.equal(parseBroadcastTitle('Show : CNN : Smarch 5, 2026 1:00pm-2:00pm PST'), null);
assert.equal(parseBroadcastTitle('election results'), null);

// Plain text: colons and other Lucene operators are escaped so they cannot be read as field names.
assert.equal(escapeLuceneText('Trump: debate'), 'Trump\\: debate');
assert.equal(escapeLuceneText('budget (2026) [draft]'), 'budget \\(2026\\) \\[draft\\]');
assert.equal(escapeLuceneText('"supreme court" ruling'), '"supreme court" ruling'); // balanced phrase kept
assert.equal(escapeLuceneText('unbalanced "quote'), 'unbalanced quote'); // stray quote dropped, never a syntax error
assert.equal(escapeLuceneText('a/b ^c ~d !e'), 'a\\/b \\^c \\~d \\!e');
assert.equal(tvNewsQueryClause('election'), '(election)');
assert.equal(tvNewsQueryClause('   '), null);
assert.equal(tvNewsQueryClause(undefined), null);
console.log('TV News query: PASS (pasted broadcast title -> exact identifier lookup incl. UTC rollover; operators escaped; stray quotes safe)');
