import assert from "node:assert/strict";
import { buildLiveKey } from "./src/guide/programHours";
import { buildRundown, nextUp, type ProgramLike } from "./src/guide/rundown";

function localTimeMs(hours: number, minutes = 0, seconds = 0): number {
  const d = new Date(2026, 10, 8, 0, 0, 0, 0);
  d.setHours(hours, minutes, seconds, 0);
  return d.getTime();
}

const samplePrograms: ProgramLike[] = [
  { id: "p1", title: "Morning Briefing S01E02", startHour: 6, endHour: 8 },
  { id: "p2", title: "Midday Report", startHour: 8, endHour: 10, metadata: { season: 3, episode: 7 } },
  // 10:00 to 12:00 is an unscheduled gap
  { id: "p3", title: "Afternoon Feature", startHour: 12, endHour: 14 },
  { id: "p4", title: "Evening Archive", startHour: 14, endHour: 16 },
];

// 1. Before-first-program (05:00)
{
  const r = buildRundown(samplePrograms, localTimeMs(5, 0));
  assert.equal(r.past.length, 0);
  assert.equal(r.now, null);
  assert.equal(r.upcoming.length, 4);
  assert.equal(r.upcoming[0].id, "p1");
  assert.equal(r.upcoming[0].seasonEpisode, "S01E02");
  assert.equal(r.upcoming[1].seasonEpisode, "S03E07");
  assert.equal(r.upcoming[2].seasonEpisode, null);
}

// 2. Mid-program (07:30 -> 75% through p1, 30 min left)
{
  const r = buildRundown(samplePrograms, localTimeMs(7, 30));
  assert.equal(r.past.length, 0);
  assert.ok(r.now !== null);
  assert.equal(r.now.id, "p1");
  assert.equal(r.now.minutesRemaining, 30);
  assert.ok(Math.abs(r.now.progress - 0.75) < 1e-6);
  assert.equal(r.upcoming.length, 3);
  assert.deepEqual(
    r.upcoming.map((u) => u.id),
    ["p2", "p3", "p4"],
  );
}

// 3. Gap between programs (11:00 -> between 10:00 and 12:00, now = null)
{
  const r = buildRundown(samplePrograms, localTimeMs(11, 0));
  assert.deepEqual(
    r.past.map((p) => p.id),
    ["p1", "p2"],
  );
  assert.equal(r.now, null);
  assert.deepEqual(
    r.upcoming.map((u) => u.id),
    ["p3", "p4"],
  );
}

// 4. After-last-program (18:00)
{
  const r = buildRundown(samplePrograms, localTimeMs(18, 0));
  assert.equal(r.past.length, 4);
  assert.equal(r.now, null);
  assert.equal(r.upcoming.length, 0);
}

// 5. Program crossing midnight (23:00 -> 01:00 wrap-around and 23:00 -> 25:00 extended)
{
  const wrapPrograms: ProgramLike[] = [
    { id: "early", title: "Evening Lead-in", startHour: 21, endHour: 23 },
    { id: "late-wrap", title: "Late Night Special", startHour: 23, endHour: 1 },
  ];
  const at2330 = buildRundown(wrapPrograms, localTimeMs(23, 30));
  assert.equal(at2330.past.length, 1);
  assert.equal(at2330.now?.id, "late-wrap");
  assert.equal(at2330.now?.minutesRemaining, 90);
  assert.ok(Math.abs((at2330.now?.progress ?? 0) - 0.25) < 1e-6);

  const at0030 = buildRundown(wrapPrograms, localTimeMs(0, 30));
  assert.equal(at0030.now?.id, "late-wrap");
  assert.equal(at0030.now?.minutesRemaining, 30);
  assert.ok(Math.abs((at0030.now?.progress ?? 0) - 0.75) < 1e-6);

  const extendedPrograms: ProgramLike[] = [
    { id: "late-ext", title: "Extended Midnight Show", startHour: 23, endHour: 25 },
  ];
  const extAt2345 = buildRundown(extendedPrograms, localTimeMs(23, 45));
  assert.equal(extAt2345.now?.id, "late-ext");
  assert.equal(extAt2345.now?.minutesRemaining, 75);
}

// 6. Empty list
{
  const r = buildRundown([], localTimeMs(12, 0));
  assert.deepEqual(r, { past: [], now: null, upcoming: [] });
  assert.deepEqual(nextUp([], localTimeMs(12, 0), 3), []);
}

// 7. nextUp with count > available and standard counts
{
  const next2 = nextUp(samplePrograms, localTimeMs(7, 0), 2);
  assert.deepEqual(
    next2.map((e) => e.id),
    ["p2", "p3"],
  );
  const next10 = nextUp(samplePrograms, localTimeMs(7, 0), 10);
  assert.deepEqual(
    next10.map((e) => e.id),
    ["p2", "p3", "p4"],
  );
  assert.deepEqual(nextUp(samplePrograms, localTimeMs(7, 0), 0), []);
}

// 8. buildLiveKey fallback when program has no id
{
  assert.equal(buildLiveKey("ch-1", null), null);
  assert.equal(
    buildLiveKey("ch-1", { program: { id: "prog-99", title: "News" }, sHour: 14 }),
    "prog-99:14",
  );
  assert.equal(
    buildLiveKey("ch-1", { program: { id: "", title: "Untitled Show" }, sHour: 14.5 }),
    "ch-1:14.5:Untitled Show",
  );
  assert.equal(
    buildLiveKey("ch-1", { program: { title: "No Id Show" }, sHour: 9 }),
    "ch-1:9:No Id Show",
  );
}

console.log("[rundown] PASS — before-first, mid-program, gap (now=null), after-last, midnight crossing, empty list, nextUp count>available, liveKey fallback");
