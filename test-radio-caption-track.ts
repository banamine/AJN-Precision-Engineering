import assert from "node:assert/strict";
import { SliceStore, visibleLines, wantedSlices } from "./src/news/captions/captionTrack.ts";
import { radioFixtureSlice } from "./test-radio-caption-fixtures.ts";

const zero = radioFixtureSlice(0);
const sixty = radioFixtureSlice(60);
assert.equal(zero.length, 17);
assert.equal(sixty.length, 19);
assert.deepEqual([zero[0].start, zero.at(-1)?.start], [0.15, 58.2]);
assert.deepEqual([sixty[0].start, sixty.at(-1)?.start], [60.12, 118.43]);
const store = new SliceStore();
store.put(0, zero);
store.put(60, sixty);

const cases = [
  { position: 10, wanted: [0], currentId: "SYNTHETIC_FIXTURE_T0_02", currentStart: 7.406, before: 2 },
  { position: 58.9, wanted: [0, 60], currentId: "SYNTHETIC_FIXTURE_T0_16", currentStart: 58.2, before: 4 },
  // The prior 0-second slice is retained for history, so four preceding lines remain visible.
  { position: 60.2, wanted: [60], currentId: "SYNTHETIC_FIXTURE_T60_00", currentStart: 60.12, before: 4 },
  { position: 118, wanted: [60, 120], currentId: "SYNTHETIC_FIXTURE_T60_17", currentStart: 115.191, before: 4 },
];
for (const item of cases) {
  assert.deepEqual(wantedSlices(item.position), item.wanted);
  const lines = visibleLines(store.cues(), item.position, "asr");
  assert.equal(lines.current?.text, item.currentId, `current fixture cue at ${item.position}s`);
  assert.equal(lines.current?.start, item.currentStart);
  assert.equal(lines.before.length, item.before);
  console.log(`${item.position.toFixed(1)}s: wanted=${JSON.stringify(item.wanted)} current=${lines.current?.text}@${lines.current?.start}s before=${lines.before.length}`);
}

const at62 = visibleLines(store.cues(), 62, "asr");
assert.equal(at62.current?.start, 60.12, "server cue start is already absolute; do not add the slice start again");
assert.ok(at62.current!.start <= 62 && 60.12 + 60 > 62, "double-offset control would fall after the playhead");
console.log(`62.0s no-double-offset: current=${at62.current?.start}s; doubled=${at62.current!.start + 60}s`);
console.log("radio caption pure fixture logic: all passed");
