import assert from "node:assert/strict";
import { tuneIn, findLiveProgram, isLiveStream } from "./src/guide/liveTune";
import { computeWindow, panBy, intersects, redLineLeft, followStart } from "./src/guide/timeWindow";
const P = (o: any) => ({ id: "p", title: "T", archivePath: "/a.mp4", ...o }) as any;
// tune-in offset
let t = tuneIn(P({}), 10, 11, 10.5);
assert.equal(t.startAtSeconds, 1800); assert.equal(t.path, "/a.mp4");
assert.equal(tuneIn(P({}), 10, 11, 10).startAtSeconds, undefined);
assert.equal(tuneIn(P({ sourceClass: "m3u_live" }), 10, 11, 10.5).startAtSeconds, undefined);
assert.equal(isLiveStream(P({ metadata: { epg: "utc" } })), true);
// segmented programme: 3 x 100s clips, 150s in -> clip 2 at 50s
const segs = [0, 1, 2].map((i) => ({ archivePath: `/c${i}.mp4`, start: i * 100, end: i * 100 + 100 }));
t = tuneIn(P({ metadata: { segments: segs } }), 0, 1, 150 / 3600);
assert.equal(t.path, "/c1.mp4"); assert.equal(t.startAtSeconds, 50);
assert.equal(tuneIn(P({ metadata: { segments: [{ archivePath: "/x" }, { archivePath: "/y" }] } }), 0, 1, 0.1).exact, false);
// findLive
const ch: any = { id: "c", name: "C", programs: [P({ id: "a", startHour: 9, endHour: 10 }), P({ id: "b", startHour: 10, endHour: 11 })] };
assert.equal(findLiveProgram(ch, 10.2)?.program.id, "b");
assert.equal(findLiveProgram(ch, 12), null);
// window
const w = computeWindow(14.5, 960);
assert.equal(w.hours, 6); assert.ok(w.startHour <= 14.5 && w.endHour > 14.5);
assert.equal(w.startHour, 13); assert.equal(Math.round(w.pxPerHour), 160);
assert.equal(computeWindow(0.2, 960).startHour, 0);
assert.equal(computeWindow(23.9, 960).endHour, 24);
assert.equal(computeWindow(14, 960, 3, 4).startHour, 3); assert.equal(computeWindow(14, 960, 3, 4).hours, 4);
assert.equal(computeWindow(14, 300).hours, 2);
assert.equal(followStart(12, 6), 10.5);
assert.ok(intersects(9, 10, w) === false && intersects(12.5, 13.5, w) === true);
assert.equal(redLineLeft(14.5, w), 1.5 * w.pxPerHour); assert.equal(redLineLeft(5, w), null);
assert.equal(panBy(w, 1), 16); assert.equal(panBy(computeWindow(1, 960), -1), 0);
console.log("PASS epg tune/window");
