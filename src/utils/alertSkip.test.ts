import assert from 'node:assert/strict';
import { NUDGE_SECONDS, PENDING_CUE_MS, PLAY_LEAD_IN_SECONDS, activeHit, fmtClock, hitsForEpisode, nextHit, prevHit, startAtFor, stepCue } from './alertSkip.ts';
import type { AlertHit } from './alertMatch.ts';

// stepping by line: rapid presses stack on the last target instead of the stale current line
let r = stepCue(null, 10, 1, 100, 1000)!; assert.equal(r.index, 11);
r = stepCue(r.cursor, 10, 1, 100, 1000 + 300)!; assert.equal(r.index, 12, 'a second quick press adds on (captions still say 10)');
r = stepCue(r.cursor, 10, 1, 100, 1000 + 600)!; assert.equal(r.index, 13);
r = stepCue(r.cursor, 13, -1, 100, 1000 + 600 + PENDING_CUE_MS + 1)!; assert.equal(r.index, 12, 'after the window, the captions line is the base again');
assert.equal(stepCue(null, 0, -1, 100, 0), null, 'nothing before the first line');
assert.equal(stepCue(null, 99, 1, 100, 0), null, 'nothing after the last line');
assert.equal(stepCue(null, -1, 1, 100, 0)!.index, 0, 'before the first line, Next goes to line 0');
assert.equal(stepCue(null, 0, 1, 0, 0), null, 'no cues');
assert.deepEqual([...NUDGE_SECONDS], [-10, 10, 30]);

// hits
const h = (cueIndex: number, programId = 'p1'): AlertHit => ({ id: `h${cueIndex}${programId}`, ruleId: 'r', ruleName: 'R', termType: 'keyword', term: 't', matchedTerms: ['t'], showId: 's', showName: 'S', channelId: 'pod-s', programId, guid: 'g', title: 'T', publishedAt: 1, url: 'https://x', cueIndex, cueStart: cueIndex * 10, cueEnd: cueIndex * 10 + 4, snippet: '', archive: false, timing: 'clean-show' });
const all = [h(50), h(5), h(20, 'p2'), h(30)];
const mine = hitsForEpisode(all, 'p1'); assert.deepEqual(mine.map((x) => x.cueIndex), [5, 30, 50], 'only this episode, in transcript order');
assert.equal(nextHit(mine, 5)!.cueIndex, 30); assert.equal(nextHit(mine, 50), null); assert.equal(nextHit(mine, -1)!.cueIndex, 5);
assert.equal(prevHit(mine, 30)!.cueIndex, 5); assert.equal(prevHit(mine, 5), null); assert.equal(prevHit(mine, 99)!.cueIndex, 50);
assert.equal(activeHit(mine, 30)!.cueIndex, 30); assert.equal(activeHit(mine, 40)!.cueIndex, 30); assert.equal(activeHit(mine, 4), null, 'before the first hit there is none to return to');

// play from here
assert.equal(startAtFor({ cueStart: 100 }), 100 - PLAY_LEAD_IN_SECONDS); assert.equal(startAtFor({ cueStart: 3 }), 0, 'never before the start'); assert.equal(startAtFor({ cueStart: 100.9 }), 92);
assert.equal(fmtClock(65), '1:05'); assert.equal(fmtClock(3725), '1:02:05'); assert.equal(fmtClock(-4), '0:00');
console.log('alertSkip tests passed');
