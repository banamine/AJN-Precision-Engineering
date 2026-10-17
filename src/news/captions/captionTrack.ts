// Pure client logic for the TV News caption panel (no React, no network). Tested offline.
export type CaptionKind = "aligned" | "broadcast-cc" | "asr";
export interface Cue { start: number; end: number; text: string }

export const SLICE_SECONDS = 60;
export const PREFETCH_AFTER_SECONDS = 30; // ask for the next slice once this far into the current one
export const HIDE_AFTER_CUE_SECONDS = 4;  // a line stays up this long after its end, then the panel shows "listening"
export const MAX_REQUESTS_PER_MINUTE = 20;
export const MAX_REQUESTS_PER_SESSION = 100;
/** Seconds added to the playhead before looking up a cue. 0 = show lines at the time the file says.
 *  Measured once (Fox, 6 cues): cc5 starts about 4.6 s after align. Tune here, nowhere else. */
export const KIND_LEAD_SECONDS: Record<CaptionKind, number> = { aligned: 0, "broadcast-cc": 0, asr: 0 };

/** Channel programs carry archivePath "/download/<ID>/<ID>.mp4?exact=1&start=S&end=E". Anything else is not a TV News clip. */
export function parseProgramRef(archivePath: string | undefined | null): { id: string; clipStart: number } | null {
  const m = /^\/download\/([A-Za-z0-9]{2,20}_\d{8}_\d{6}(?:_[A-Za-z0-9._-]{0,150})?)\/\1\.mp4(?:\?(.*))?$/.exec(String(archivePath ?? ""));
  if (!m) return null;
  const q = new URLSearchParams(m[2] ?? "");
  const s = q.get("start");
  const clipStart = s !== null && /^\d+$/.test(s) ? Number(s) : 0;
  return { id: m[1], clipStart };
}

export function sliceStartFor(position: number): number {
  return Math.max(0, Math.floor(position / SLICE_SECONDS)) * SLICE_SECONDS;
}

/** Slice starts wanted right now: the current one, plus the next once we are past PREFETCH_AFTER_SECONDS. */
export function wantedSlices(position: number, programSeconds?: number): number[] {
  const cur = sliceStartFor(position);
  const out = [cur];
  if (position - cur >= PREFETCH_AFTER_SECONDS) out.push(cur + SLICE_SECONDS);
  return programSeconds && programSeconds > 0 ? out.filter((s) => s < programSeconds) : out;
}

export class SliceStore {
  private slices = new Map<number, Cue[]>();
  has(start: number) { return this.slices.has(start); }
  put(start: number, cues: Cue[]) { this.slices.set(start, cues); }
  /** Forget slices well behind the playhead so memory stays bounded. */
  prune(position: number) {
    const keepFrom = sliceStartFor(position) - SLICE_SECONDS;
    for (const k of [...this.slices.keys()]) if (k < keepFrom) this.slices.delete(k);
  }
  size() { return this.slices.size; }
  clear() { this.slices.clear(); }
  /** All held cues in time order, with the duplicate a cue straddling two slices would cause removed. */
  cues(): Cue[] {
    const seen = new Set<string>();
    const all: Cue[] = [];
    for (const list of this.slices.values()) {
      for (const c of list) {
        const key = `${Math.round(c.start * 10)}|${c.text}`;
        if (seen.has(key)) continue;
        seen.add(key); all.push(c);
      }
    }
    return all.sort((a, b) => a.start - b.start || a.end - b.end);
  }
}

/** Lines to show at `position` (program seconds): the current line plus a few before it. */
export function visibleLines(cues: Cue[], position: number, kind: CaptionKind, history = 4): { current: Cue | null; before: Cue[] } {
  const p = position + KIND_LEAD_SECONDS[kind];
  let idx = -1;
  for (let i = 0; i < cues.length; i += 1) { if (cues[i].start <= p) idx = i; else break; }
  if (idx < 0) return { current: null, before: [] };
  const cur = cues[idx];
  const live = p <= cur.end + HIDE_AFTER_CUE_SECONDS;
  const before = cues.slice(Math.max(0, idx - history), idx);
  return live ? { current: cur, before } : { current: null, before: cues.slice(Math.max(0, idx + 1 - history), idx + 1) };
}

/** Sliding-window request budget: 20 a minute and 100 a session for one browser tab. */
export class RequestBudget {
  private stamps: number[] = [];
  private total = 0;
  constructor(private perMinute = MAX_REQUESTS_PER_MINUTE, private perSession = MAX_REQUESTS_PER_SESSION) {}
  canRequest(now: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    return this.total < this.perSession && this.stamps.length < this.perMinute;
  }
  record(now: number) { this.stamps.push(now); this.total += 1; }
  used() { return { lastMinute: this.stamps.length, session: this.total }; }
}
