import assert from "node:assert/strict";
import { groupProgramsForGrid, MIN_CELL_PX, COMFORT_CELL_PX } from "./src/guide/groupProgramsForGrid";
import type { ScheduleChannel, Program } from "./src/types";

function prog(i: number, s: number, e: number, lane?: string): Program {
  return { id: `p${i}`, guideId: "audio-podcasts", channelId: "c", title: `T${i}`, startTime: s, endTime: e, startHour: s, endHour: e,
    mediaType: "audio", mediaUrl: `u${i}`, metadata: lane ? { lane } : {} };
}
function chan(programs: Program[], id = "item-music-x"): ScheduleChannel {
  return { id, guideId: "audio-podcasts", name: "X", mediaType: "audio", programs };
}

export function runGroupingTests(): void {
  assert.equal(MIN_CELL_PX, 64); assert.equal(COMFORT_CELL_PX, 96);
  // Fractional durations cross midnight: the final in-window track is clipped,
  // while later tracks remain in the source and must not enter the grid.
  const step = 4.1 / 60;
  const tracks = Array.from({ length: 370 }, (_, i) => prog(i, i * step, (i + 1) * step, "music"));
  const ch = chan(tracks);
  const before = JSON.stringify(ch);
  const now = 10.01; // inside a track
  const r = groupProgramsForGrid(ch, 160, now);
  assert.equal(r.mode, "blocks");
  assert.equal(JSON.stringify(ch), before, "input not mutated");
  const inWindow = tracks.filter((p) => p.startHour! < 24 && p.endHour! > 0);
  assert.deepEqual(r.cells.flatMap((c) => c.items.map((i) => i.program.id)), inWindow.map((p) => p.id));
  const sum = r.cells.reduce((a, c) => a + c.minutes, 0);
  assert.ok(inWindow.at(-1)!.endHour! > 24, "fixture really crosses the window boundary");
  assert.ok(Math.abs(sum - inWindow.reduce((a, p) => a + (Math.min(24, p.endHour!) - Math.max(0, p.startHour!)) * 60, 0)) < 1e-8,
    'block totals must equal clipped original durations without per-block rounding');
  for (const c of r.cells) {
    assert.equal(c.first, c.items[0].index + 1); assert.equal(c.last, c.items[c.items.length - 1].index + 1);
    assert.equal(c.total, 370);
  }
  assert.ok(r.cells[5].first > 1, "real indices, not counts");
  const liveBlocks = r.cells.filter((c) => c.liveProgramId);
  assert.equal(liveBlocks.length, 1); assert.equal(liveBlocks[0].startHour, 10);
  assert.equal(liveBlocks[0].liveProgramId, r.liveItem!.program.id);

  // continuation: live track started in previous bucket
  const spanning = [prog(0, 0.5, 1.5, "music"), ...Array.from({ length: 40 }, (_, i) => prog(i + 1, 1.5 + i * 0.01, 1.5 + (i + 1) * 0.01, "music"))];
  const r2 = groupProgramsForGrid(chan(spanning), 160, 1.2);
  assert.equal(r2.mode, "blocks");
  const b1 = r2.cells.find((c) => c.startHour === 1)!;
  assert.equal(b1.liveProgramId, "p0"); assert.equal(b1.continuesFrom, true);
  assert.equal(r2.cells.find((c) => c.startHour === 0)!.items[0].continuesInto, true);
  assert.equal(r2.cells.flatMap((c) => c.items).length, spanning.length, "assigned once");

  // long programs stay programs; non-music lane never grouped
  const long = chan(Array.from({ length: 8 }, (_, i) => prog(i, i * 3, i * 3 + 3, "music")));
  assert.equal(groupProgramsForGrid(long, 160, 1).mode, "programs");
  assert.equal(groupProgramsForGrid(chan(tracks.map((p) => ({ ...p, metadata: {} })), "rush"), 160, 1).mode, "programs");

  const exactlyTwentyPercent = [
    prog(0, 0, 0.1, "music"), prog(1, 0.1, 0.2, "music"),
    ...Array.from({ length: 8 }, (_, i) => prog(i + 2, 0.2 + i * 2, 2.2 + i * 2, "music")),
  ];
  assert.equal(groupProgramsForGrid(chan(exactlyTwentyPercent), 160).mode, "programs",
    "20% is not more than 20%");
}

if (process.argv[1]?.endsWith("test-group-programs-for-grid.ts")) { runGroupingTests(); console.log("grouping tests passed"); }
