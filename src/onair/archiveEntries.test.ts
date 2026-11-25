import assert from 'node:assert';
import { buildEntries, pickEntry, STORY_DWELL_MS, ITEM_DWELL_MS, diverseHeadlines } from './archiveEntries';
const e = buildEntries(4, 2, 3, true);
assert.deepEqual(e.map((x) => `${x.kind}${x.index}`), ['story0', 'story1', 'story2', 'item0', 'story3', 'item1', 'item2', 'rush0']);
assert.equal(buildEntries(0, 0, 0, false).length, 0); assert.equal(pickEntry([], 5), null);
assert.deepEqual(buildEntries(0, 0, 2, true).map((x) => x.kind), ['item', 'item', 'rush'], 'no stories: exactly the old panel');
assert.deepEqual(buildEntries(2, 0, 0, false).map((x) => x.kind), ['story', 'story']);
const p0 = pickEntry(e, 0)!; assert.equal(p0.n, 1); assert.equal(pickEntry(e, STORY_DWELL_MS - 1)!.n, 1); assert.equal(pickEntry(e, STORY_DWELL_MS)!.n, 2);
const cycle = e.reduce((a, x) => a + (x.kind === 'story' ? STORY_DWELL_MS : ITEM_DWELL_MS), 0);
assert.equal(pickEntry(e, cycle)!.n, 1, 'wraps'); assert.equal(pickEntry(e, 3 * STORY_DWELL_MS + ITEM_DWELL_MS - 1)!.n, 4);
console.log('archiveEntries tests ok');

const n0 = buildEntries(3, 0, 0, false); assert.equal(n0.some((x) => x.kind === 'news'), false);
const n2 = buildEntries(6, 0, 0, false, 2);
assert.equal(n2.filter((x) => x.kind === 'news').length, 2);
assert.equal(n2[0].kind, 'story'); assert.ok(n2.findIndex((x) => x.kind === 'news') > 0);
assert.deepEqual(buildEntries(0, 0, 0, false, 1), [{ kind: 'news', index: 0 }]);

const hl = [{ source: 'A', publishedMs: 9 }, { source: 'A', publishedMs: 8 }, { source: 'A', publishedMs: 7 }, { source: 'B', publishedMs: 6 }, { source: 'C', publishedMs: 5 }];
assert.deepEqual(diverseHeadlines(hl, 4).map((x) => `${x.source}${x.publishedMs}`), ['A9', 'B6', 'C5', 'A8']);
assert.equal(diverseHeadlines([], 4).length, 0);
