// Bounded, memory-only pool of TV caption minutes (application-level policy exception, owner-approved 2026-11-08):
// caption text lives ONLY in this process's memory, bounded by age, item count and UTF-8 byte budget.
// No application-level persistence: no disk, logs, telemetry or browser storage. Expired/evicted items and their
// dedup keys are removed together. The ring never fetches, parses or clusters; it only retains.
// Synchronous by design (single event-loop owner). This does not settle Archive's terms of use.
import { Buffer } from 'node:buffer';

export interface PoolLimits { capacity: number; maxTextBytes: number; retentionMs: number }
export const DEFAULT_POOL_LIMITS: Readonly<PoolLimits> = Object.freeze({
  capacity: 1_440,               // 4 channels x 360 minutes
  maxTextBytes: 8 * 1024 * 1024, // caption payload only, not total process memory
  retentionMs: 6 * 60 * 60 * 1000,
});

export interface PoolMinuteInput {
  channel: string;     // e.g. "FOXNEWSW"
  programId: string;   // Archive identifier
  programTitle: string;
  startSec: number;    // Archive's own per-minute offset into the program
  clock: string;       // clock label printed by Archive for that minute
  airTimeMs: number;   // program start (from the identifier) + startSec
  text: string;        // original caption wording, unmodified
}
export type PoolMinute = Readonly<PoolMinuteInput & { id: number; fetchedAtMs: number; textBytes: number; key: string }>;
export type IngestResult = 'added' | 'duplicate' | 'rejected';

function assertClock(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
}

export class CaptionPool {
  private readonly slots: Array<PoolMinute | undefined>;
  private readonly seen = new Map<string, number>(); // dedup key -> id; entries die with their item
  private head = 0; private count = 0; private textBytes = 0; private nextId = 1;
  private readonly limits: Readonly<PoolLimits>;

  constructor(limits: PoolLimits = DEFAULT_POOL_LIMITS) {
    if (!Number.isSafeInteger(limits.capacity) || limits.capacity < 1 || !Number.isSafeInteger(limits.maxTextBytes) || limits.maxTextBytes < 1 || !Number.isFinite(limits.retentionMs) || limits.retentionMs <= 0) {
      throw new RangeError('Invalid caption pool limits');
    }
    this.limits = Object.freeze({ ...limits });
    this.slots = new Array(limits.capacity);
  }

  private slot(offset: number) { return (this.head + offset) % this.limits.capacity; }

  private removeOldest(): void {
    if (this.count === 0) return;
    const item = this.slots[this.head]!;
    this.slots[this.head] = undefined;
    this.seen.delete(item.key);
    this.textBytes -= item.textBytes;
    this.head = (this.head + 1) % this.limits.capacity;
    this.count--;
    if (this.count === 0) this.head = 0;
  }

  prune(nowMs: number = Date.now()): void {
    assertClock(nowMs);
    const cutoff = nowMs - this.limits.retentionMs;
    const before = this.count;
    let kept = 0; let keptBytes = 0;
    for (let read = 0; read < before; read++) {
      const item = this.slots[this.slot(read)]!;
      if (item.airTimeMs <= cutoff) { this.seen.delete(item.key); continue; }
      this.slots[this.slot(kept)] = item; keptBytes += item.textBytes; kept++;
    }
    for (let o = kept; o < before; o++) this.slots[this.slot(o)] = undefined;
    this.count = kept; this.textBytes = keptBytes;
    if (kept === 0) this.head = 0;
  }

  ingest(input: PoolMinuteInput, nowMs: number = Date.now()): IngestResult {
    assertClock(nowMs); // before any state change
    if (
      typeof input.channel !== 'string' || !input.channel || input.channel.length > 32 ||
      typeof input.programId !== 'string' || !input.programId || input.programId.length > 256 ||
      typeof input.programTitle !== 'string' || input.programTitle.length > 256 ||
      typeof input.clock !== 'string' || input.clock.length > 16 ||
      !Number.isFinite(input.startSec) || input.startSec < 0 ||
      !Number.isFinite(input.airTimeMs) ||
      typeof input.text !== 'string' || input.text.length > 32_768 || input.text.trim().length === 0
    ) return 'rejected';
    this.prune(nowMs);
    if (input.airTimeMs <= nowMs - this.limits.retentionMs || input.airTimeMs > nowMs) return 'rejected';
    const key = `${input.channel}|${input.programId}|${input.startSec}`;
    if (this.seen.has(key)) return 'duplicate';
    const bytes = Buffer.byteLength(input.text, 'utf8');
    if (bytes > this.limits.maxTextBytes) return 'rejected'; // never evict good data for an unfittable item
    while (this.count >= this.limits.capacity || this.textBytes + bytes > this.limits.maxTextBytes) this.removeOldest();
    const item: PoolMinute = Object.freeze({ ...input, id: this.nextId++, fetchedAtMs: nowMs, textBytes: bytes, key });
    this.slots[this.slot(this.count)] = item;
    this.seen.set(key, item.id);
    this.count++; this.textBytes += bytes;
    return 'added';
  }

  /** Detached, bounded snapshot: minutes of the channel's newest program, ordered by startSec. */
  newestProgram(channel: string, limit = 200, nowMs: number = Date.now()): PoolMinute[] {
    assertClock(nowMs);
    this.prune(nowMs);
    let newestProgramId: string | null = null; let newestStart = -Infinity;
    for (let o = 0; o < this.count; o++) {
      const it = this.slots[this.slot(o)]!;
      const start = it.airTimeMs - it.startSec * 1000;
      if (it.channel === channel && start > newestStart) { newestStart = start; newestProgramId = it.programId; }
    }
    if (newestProgramId === null) return [];
    const out: PoolMinute[] = [];
    for (let o = 0; o < this.count; o++) {
      const it = this.slots[this.slot(o)]!;
      if (it.channel === channel && it.programId === newestProgramId) out.push(it);
    }
    out.sort((a, b) => a.startSec - b.startSec);
    return out.slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
  }

  /** Retained minute texts (references to immutable strings) for corpus statistics. Detached array, bounded by capacity. */
  texts(nowMs: number = Date.now()): string[] {
    assertClock(nowMs);
    this.prune(nowMs);
    const out: string[] = [];
    for (let o = 0; o < this.count; o++) out.push(this.slots[this.slot(o)]!.text);
    return out;
  }

  clear(): void {
    this.slots.fill(undefined); this.seen.clear();
    this.head = 0; this.count = 0; this.textBytes = 0;
  }

  get stats() {
    return { items: this.count, capacity: this.limits.capacity, captionTextBytes: this.textBytes, maxCaptionTextBytes: this.limits.maxTextBytes, dedupEntries: this.seen.size };
  }
}

export function createCaptionPool(limits: PoolLimits = DEFAULT_POOL_LIMITS): CaptionPool { return new CaptionPool(limits); }

