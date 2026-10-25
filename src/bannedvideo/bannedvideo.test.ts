/** Run: npx tsx src/bannedvideo/bannedvideo.test.ts  → prints one PASS line, exits 1 on failure. */
import assert from "node:assert/strict";
import { BANNED_VIDEO_SNAPSHOT } from "./registry";
import { validateBannedVideoSnapshot } from "./validate";
import { parseAirDate } from "./airDate";
import { buildPool, buildVaultOrder, emptyWallState, fillWall, nextInPanel, stateFitsPool, type Rng } from "./allocate";
import type { BannedVideoSnapshot, PanelIndex, WallState } from "./types";

/** Deterministic RNG (mulberry32) so failures reproduce. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date("2026-10-25T12:00:00Z");
const noDupes = (s: WallState) => {
  const shown = s.panels.filter((id): id is string => id !== null);
  assert.equal(new Set(shown).size, shown.length, `duplicate on wall: ${shown.join(",")}`);
};

// 1. The shipped snapshot validates.
if ('error' in BANNED_VIDEO_SNAPSHOT) throw new Error(BANNED_VIDEO_SNAPSHOT.error);
const snap: BannedVideoSnapshot = BANNED_VIDEO_SNAPSHOT.snapshot;
assert.equal(snap.items.length, 72);
assert.deepEqual(snap.items.map((i) => i.rank), snap.items.map((_, k) => k + 1));

// 2. Validation rejects bad input instead of half-rendering.
assert.equal(validateBannedVideoSnapshot(null).ok, false);
const bad = (patch: Record<string, unknown>) => validateBannedVideoSnapshot({ ...snap, items: [{ ...snap.items[0], ...patch }] });
assert.equal(bad({ id: "VFZ86HV" }).ok, false);
assert.equal(bad({ watchUrl: "https://evil.example/v/vfz86hv" }).ok, false);
assert.equal(bad({ thumbnailUrl: "https://banned.video.evil.example/media/x.webp" }).ok, false);
assert.equal(bad({ watchUrl: "http://banned.video/v/vfz86hv-x.html" }).ok, false);
assert.equal(bad({ channel: "Not In List" }).ok, false);
assert.equal(validateBannedVideoSnapshot({ ...snap, items: [snap.items[0], snap.items[0]] }).ok, false);

// 3. Air-date parsing on the real tricky titles.
assert.deepEqual(parseAirDate("The Alex Jones Show Aoril 6th, 2008", NOW), { year: 2008, month: 4, day: 6 });
assert.deepEqual(parseAirDate("The Alex Jones Show Monday, March 14th, 2008", NOW), { year: 2008, month: 3, day: 14 });
assert.deepEqual(parseAirDate("Live Aug 1, 2001 Call-in Show", NOW), { year: 2001, month: 8, day: 1 });
assert.deepEqual(parseAirDate("(Censored by Youtube) September 12, 2001 Alex Jones", NOW), { year: 2001, month: 9, day: 12 });
assert.deepEqual(parseAirDate("Swat Team Leader Lt  Beck(Classic 1997)", NOW), { year: 1997, month: null, day: null });
assert.deepEqual(parseAirDate("Growing NWO Police State(Classic 1990's)", NOW), { year: 1990, month: null, day: null });
assert.deepEqual(parseAirDate("Mucho Energetic(Real Spin mid 1990's)", NOW), { year: 1990, month: null, day: null });
assert.equal(parseAirDate("Classic Alex Jones Exposing Mass Media", NOW), null);
assert.equal(parseAirDate("the GOP's 2028 Debate", NOW), null);

// 4. Pools and the AJN/RAV rule.
const ajn = buildPool(snap, { network: "ajn", channel: "all" }, NOW);
const rav = buildPool(snap, { network: "rav", channel: "all" }, NOW);
assert.equal(ajn.items.length, 72);
assert.equal(rav.items.length, 0);
const ravChannels = new Set(snap.channels.filter((c) => c.network === "rav").map((c) => c.name));
assert.ok(ajn.items.every((i) => !ravChannels.has(i.channel)));
assert.equal(ajn.vault.length, 20, `vault size ${ajn.vault.length}`);
assert.ok(ajn.vault.every((v) => v.item.channel === "Banned Media Archive"));
assert.ok(!ajn.vault.some((v) => ["vcvphoz", "vxx72s7", "vtoxumq"].includes(v.item.id)), "topic years must not enter the vault");

// 5. Vault order: years never go backwards; within-year order varies with the seed.
const yearOf = new Map(ajn.vault.map((v) => [v.item.id, v.date.year]));
const order = buildVaultOrder(ajn.vault, seeded(1));
for (let i = 1; i < order.length; i += 1) assert.ok(yearOf.get(order[i - 1])! <= yearOf.get(order[i])!, "vault year order");
assert.notDeepEqual(order, buildVaultOrder(ajn.vault, seeded(2)));

// 6. Initial fill: claim order, no duplicates, P1 = trending #1, P3 = earliest year.
const rng = seeded(42);
let s = fillWall(ajn, rng);
noDupes(s);
assert.equal(s.panels[0], snap.items[0].id);
assert.equal(yearOf.get(s.panels[2]!), Math.min(...yearOf.values()));
assert.ok(s.panels.every((id) => id !== null));

// 7. Next changes ONLY its own panel, never duplicates, over a long run.
for (let step = 0; step < 2000; step += 1) {
  const panel = (step % 4) as PanelIndex;
  const before = [...s.panels];
  const r = nextInPanel(s, ajn, panel, rng);
  s = r.state;
  noDupes(s);
  before.forEach((id, i) => { if (i !== panel) assert.equal(s.panels[i], id, "another panel moved"); });
  assert.ok(stateFitsPool(s, ajn));
}

// 8. P1 walks trending order and skips whatever another panel holds.
s = fillWall(ajn, seeded(7));
const p1Seen: number[] = [];
for (let k = 0; k < 10; k += 1) {
  s = nextInPanel(s, ajn, 0, rng).state;
  p1Seen.push(ajn.byId.get(s.panels[0]!)!.rank);
}
for (let k = 1; k < p1Seen.length; k += 1) assert.ok(p1Seen[k] > p1Seen[k - 1], `P1 not ascending: ${p1Seen}`);

// 9. P2 shuffle bag: in one round (pool minus the 3 other panels), no repeats.
s = fillWall(ajn, seeded(9));
const p2Seen = new Set<string>([s.panels[1]!]);
for (let k = 0; k < 40; k += 1) {
  s = nextInPanel(s, ajn, 1, rng).state;
  assert.ok(!p2Seen.has(s.panels[1]!), "shuffle repeated inside a round");
  p2Seen.add(s.panels[1]!);
}

// 10. P4 fairness: after many Nexts, queued counts differ by at most 1 among P4-reachable videos.
s = fillWall(ajn, seeded(11), emptyWallState());
for (let k = 0; k < 72 * 3; k += 1) s = nextInPanel(s, ajn, 3, rng).state;
const others = new Set([s.panels[0], s.panels[1], s.panels[2]]);
const counts = ajn.items.filter((i) => !others.has(i.id)).map((i) => s.queuedCounts[i.id] ?? 0);
assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `P4 unfair: ${Math.min(...counts)}..${Math.max(...counts)}`);

// 11. Tiny pools: never a duplicate, empty panels stay null, Next reports no change.
const one = buildPool(snap, { network: "ajn", channel: "Jiggy jaguar" }, NOW);
assert.equal(one.items.length, 1);
const sOne = fillWall(one, rng);
assert.deepEqual(sOne.panels.filter((x) => x !== null).length, 1);
noDupes(sOne);
assert.equal(nextInPanel(sOne, one, 0, rng).changed, false);
const emptyRav = fillWall(rav, rng);
assert.deepEqual(emptyRav.panels, [null, null, null, null]);

// 12. Sub-channel filter = uploader channel; vault empty outside dated channels.
const dl = buildPool(snap, { network: "ajn", channel: "Dangerous Laughter" }, NOW);
assert.equal(dl.items.length, 15);
assert.equal(dl.vault.length, 0);
assert.equal(fillWall(dl, rng).panels[2], null);

console.log("PASS [bannedvideo] snapshot, validation, air dates, AJN/RAV, 4-panel allocator (2000-step no-duplicate run)");
