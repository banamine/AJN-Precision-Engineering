import assert from "node:assert/strict";
import { tagMusicLane } from "./guideRegistry";
import { groupProgramsForGrid } from "./src/guide/groupProgramsForGrid";
import type { Program, ScheduleChannel } from "./src/types";

const mk = (i: number, meta: Record<string, unknown> = {}): Program => ({ id: `p${i}`, guideId: "audio-podcasts", channelId: "c", title: `T${i}`,
  startTime: i * 0.05, endTime: (i + 1) * 0.05, startHour: i * 0.05, endHour: (i + 1) * 0.05, mediaType: "audio", mediaUrl: `u${i}`, metadata: meta });
const raw = Array.from({ length: 200 }, (_, i) => mk(i));
const before = JSON.stringify(raw);
const tagged = tagMusicLane(raw);
assert.equal(JSON.stringify(raw), before, "input not mutated");
assert.ok(tagged.every((p) => p.metadata?.lane === "music"));
assert.equal(tagMusicLane([mk(1, { lane: "music", x: 1 })])[0].metadata?.x, 1, "existing metadata kept");
const ch = (programs: Program[]): ScheduleChannel => ({ id: "item-x", guideId: "audio-podcasts", name: "X", mediaType: "audio", programs });
assert.equal(groupProgramsForGrid(ch(raw), 160, 1).mode, "programs", "untagged dense channel is NOT grouped (the bug)");
assert.equal(groupProgramsForGrid(ch(tagged), 160, 1).mode, "blocks", "tagged channel is grouped");
console.log("music lane tag: ok");
