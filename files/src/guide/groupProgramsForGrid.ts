import type { Program, ScheduleChannel } from "../types";

export const MIN_CELL_PX = 64;
export const COMFORT_CELL_PX = 96;
export const NARROW_FRACTION = 0.2;
export const MAX_CELLS = 120;
/** Each grouped block should be at least this wide, so thumbnails and titles have room. */
export const BLOCK_MIN_PX = 150;
const BUCKET_STEPS = [1, 2, 3, 4, 6];

/** Smallest whole-hour bucket (1,2,3,4,6; all divide 24) whose block is >= BLOCK_MIN_PX wide at this zoom. */
export function bucketHoursFor(pxPerHour: number): number {
  if (!Number.isFinite(pxPerHour) || pxPerHour <= 0) return 1;
  return BUCKET_STEPS.find((h) => h * pxPerHour >= BLOCK_MIN_PX) ?? BUCKET_STEPS[BUCKET_STEPS.length - 1];
}

export interface GridItem {
  program: Program;
  sHour: number;
  eHour: number;
  /** Real 0-based index in channel.programs. */
  index: number;
  /** Index among the in-window items. */
  windowIdx: number;
  continuesFrom: boolean;
  continuesInto: boolean;
}

export interface GridBlock {
  id: string;
  startHour: number;
  endHour: number;
  items: GridItem[];
  /** Real 1-based first/last track numbers (0 when empty). */
  first: number;
  last: number;
  total: number;
  trackCount: number;
  minutes: number;
  continuesFrom: boolean;
  continuesInto: boolean;
  /** Live program id if now falls in this bucket (may be owned by an earlier block). */
  liveProgramId: string | null;
}

export interface GroupResult {
  mode: "programs" | "blocks" | "radio";
  items: GridItem[];
  cells: GridBlock[];
  liveItem: GridItem | null;
}

/** Same convention as EpgGuide: UTC-timed listings map to the viewer's local day. */
export function localHours(program: Program, nowMs: number = Date.now()): { sHour: number; eHour: number } {
  if ((program.metadata as any)?.epg === "utc" && program.startTimeUtc && program.endTimeUtc) {
    const midnight = new Date(nowMs); midnight.setHours(0, 0, 0, 0);
    const h = (iso: string) => (Date.parse(iso) - midnight.getTime()) / 3_600_000;
    return { sHour: Math.max(0, h(program.startTimeUtc)), eHour: Math.min(24, h(program.endTimeUtc)) };
  }
  return { sHour: program.startHour ?? program.startTime ?? 0, eHour: program.endHour ?? program.endTime ?? 24 };
}

export function isMusicChannel(channel: ScheduleChannel): boolean {
  return channel.programs.some((p) => p.metadata?.lane === "music");
}

export function windowItems(channel: ScheduleChannel, nowMs?: number): GridItem[] {
  const out: GridItem[] = [];
  channel.programs.forEach((program, index) => {
    const { sHour, eHour } = localHours(program, nowMs);
    if (sHour < 24 && eHour > 0) out.push({ program, sHour, eHour, index, windowIdx: out.length, continuesFrom: false, continuesInto: false });
  });
  return out;
}

function makeBlock(id: string, startHour: number, endHour: number, items: GridItem[], total: number, nowHour: number | undefined, live: GridItem | null): GridBlock {
  const inBucket = nowHour !== undefined && nowHour >= startHour && nowHour < endHour;
  let minutes = 0;
  for (const it of items) minutes += (Math.min(it.eHour, 24) - Math.max(it.sHour, 0)) * 60;
  return {
    id, startHour, endHour, items, total,
    first: items.length ? items[0].index + 1 : 0,
    last: items.length ? items[items.length - 1].index + 1 : 0,
    trackCount: items.length,
    minutes,
    continuesFrom: items.some((i) => i.continuesFrom),
    continuesInto: items.some((i) => i.continuesInto),
    liveProgramId: inBucket && live ? live.program.id : null,
  };
}

/** Pure. Never mutates the channel or its programs. Only music-lane channels are grouped. */
export function groupProgramsForGrid(channel: ScheduleChannel, pxPerHour: number, nowHour?: number, nowMs?: number): GroupResult {
  const raw = windowItems(channel, nowMs);
  const live = nowHour === undefined ? null : raw.find((i) => nowHour >= i.sHour && nowHour < i.eHour) ?? null;
  if (!isMusicChannel(channel) || raw.length === 0) return { mode: "programs", items: raw, cells: [], liveItem: live };
  const narrow = raw.filter((i) => (i.eHour - i.sHour) * pxPerHour < MIN_CELL_PX).length;
  if (narrow / raw.length <= NARROW_FRACTION) return { mode: "programs", items: raw, cells: [], liveItem: live };

  const total = channel.programs.length;
  const bh = bucketHoursFor(pxPerHour);
  const bucketOf = (h: number) => Math.min(24 - bh, Math.max(0, Math.floor(h / bh) * bh));
  const items = raw.map((i) => ({ ...i }));
  const buckets = new Map<number, GridItem[]>();
  for (const it of items) {
    const b = bucketOf(it.sHour);
    it.continuesInto = it.eHour > b + bh + 1e-9;
    it.continuesFrom = it.sHour < 0;
    const arr = buckets.get(b); if (arr) arr.push(it); else buckets.set(b, [it]);
  }
  // continuesFrom on a block: a track that started in an earlier bucket reaches into it.
  const cells: GridBlock[] = [];
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const spill = (b: number) => items.some((i) => i.sHour < b && i.eHour > b + 1e-9);
  for (const b of keys) {
    const bi = buckets.get(b)!;
    const blk = makeBlock(`${channel.id}-h${b}`, b, b + bh, bi, total, nowHour, live);
    if (spill(b)) blk.continuesFrom = true;
    cells.push(blk);
  }
  // The live track always marks the bucket that contains "now", even when it started in an earlier bucket.
  if (live && nowHour !== undefined) {
    const nb = bucketOf(nowHour);
    if (!cells.some((c) => c.startHour === nb)) {
      cells.push(makeBlock(`${channel.id}-h${nb}`, nb, nb + bh, [], total, nowHour, live));
      cells.sort((a, b) => a.startHour - b.startHour);
      const c = cells.find((x) => x.startHour === nb)!; c.continuesFrom = true;
    }
  }
  if (cells.length > MAX_CELLS) {
    return { mode: "radio", items, liveItem: live, cells: [makeBlock(`${channel.id}-day`, 0, 24, items, total, nowHour, live)] };
  }
  return { mode: "blocks", items, cells, liveItem: live };
}
