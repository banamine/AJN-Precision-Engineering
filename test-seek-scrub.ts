import assert from 'node:assert/strict';
import { createScrubber } from './src/utils/seekScrub.ts';
// fake timers
let now = 0; const timers = new Map<number, { at: number; fn: () => void }>(); let id = 0;
const setTimer = (fn: () => void, ms: number) => { timers.set(++id, { at: now + ms, fn }); return id; };
const clearTimer = (h: unknown) => { timers.delete(h as number); };
const advance = (ms: number) => { const end = now + ms; for (;;) { const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); } now = end; };

// 1. a 30-step drag commits exactly once, on release, at the last position
let commits: number[] = []; let drafts: (number | null)[] = [];
let s = createScrubber({ commit: (x) => commits.push(x), onDraft: (d) => drafts.push(d), setTimer, clearTimer });
s.begin(); for (let i = 1; i <= 30; i++) { s.update(i * 100); advance(60); }
advance(5000); assert.deepEqual(commits, [], 'nothing is committed while the pointer is down, however long it stays');
s.end(); assert.deepEqual(commits, [3000], 'one seek on release at the final position'); assert.equal(drafts.at(-1), null, 'draft cleared after commit');

// 2. a plain click (down, one change, up) commits once immediately
commits = []; s.begin(); s.update(1234); s.end(); assert.deepEqual(commits, [1234]);

// 3. keyboard: repeated changes with no drag commit once after the quiet period
commits = []; for (let i = 1; i <= 8; i++) { s.update(100 + i * 5); advance(80); }
assert.deepEqual(commits, [], 'still within the quiet window'); advance(300); assert.deepEqual(commits, [140], 'one seek after quiet');

// 4. release with no draft does nothing; cancel drops the draft; bad numbers ignored
commits = []; s.end(); s.update(NaN); s.end(); assert.deepEqual(commits, []);
s.begin(); s.update(50); s.cancel(); s.end(); assert.deepEqual(commits, [], 'cancel drops the draft');
s.update(-5); advance(400); assert.deepEqual(commits, [0], 'negative clamps to 0');
console.log('seek scrub: all passed');
