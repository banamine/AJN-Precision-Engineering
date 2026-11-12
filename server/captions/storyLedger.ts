// 24 h rolling, in-memory ledger of derived TV caption cards (2-minute excerpts, verbatim).
// Pure class, injected clock, NO I/O: no disk, logs, telemetry or browser storage (owner policy 2026-11-08, extended to
// derived cards 2026-11-12). Smallest practical footprint: no per-card token sets are kept (near-duplicate checks tokenise
// the few same-network cards on demand), small caps, and the 24 h age is measured by AIR time.
import { Buffer } from 'node:buffer';

export type SourceKind = 'broadcast-captions' | 'page-text';
export interface LedgerMinute { clock: string; startSec: number; text: string }

export interface StoryCard {
  id: string;
  networkCode: string;
  network: string;
  sourceKind: SourceKind;
  programId: string;
  programTitle: string;
  programStartUtc: string;
  windowStartUtc: string;
  startSec: number;
  clock: string;
  minutes: LedgerMinute[];
  textBytes: number;
  score: number;
  firstSeenMs: number;
}

export interface StoryCardInput {
  networkCode: string;
  network: string;
  sourceKind: SourceKind;
  programId: string;
  programTitle: string;
  programStartMs: number;
  windowStartMs: number;
  startSec: number;
  clock: string;
  minutes: readonly LedgerMinute[];
  score: number;
}

export interface LedgerLimits { retentionMs: number; maxCards: number; maxPerNetwork: number; maxTextBytes: number }
export const DEFAULT_LEDGER_LIMITS: Readonly<LedgerLimits> = Object.freeze({
  retentionMs: 24 * 60 * 60 * 1000,
  maxCards: 240,
  maxPerNetwork: 24,
  maxTextBytes: 512 * 1024,
});

export type LedgerIngestResult = 'added' | 'replaced' | 'duplicate' | 'rejected';
export interface CoverageWindow { requestedHours: number; coveredFromUtc: string | null; coveredToUtc: string | null; building: boolean }

const NEAR_DUP_JACCARD = 0.8;
const BUILDING_SPAN_MS = 22 * 60 * 60 * 1000;
const MAX_MINUTE_CHARS = 8_192;
const MAX_MINUTES_PER_CARD = 4;

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const assertClock = (nowMs: number) => { if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite'); };

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
const cardText = (c: StoryCard) => c.minutes.map((m) => m.text).join(' ');
const clone = (c: StoryCard): StoryCard => ({ ...c, minutes: c.minutes.map((m) => ({ clock: m.clock, startSec: m.startSec, text: m.text })) });

interface Entry { card: StoryCard; airMs: number }

export class StoryLedger {
  private entries: Entry[] = [];
  private bytes = 0;
  private readonly limits: Readonly<LedgerLimits>;

  constructor(limits: Partial<LedgerLimits> = {}) {
    const m: LedgerLimits = { ...DEFAULT_LEDGER_LIMITS, ...limits };
    if (!Number.isFinite(m.retentionMs) || m.retentionMs <= 0 || !Number.isSafeInteger(m.maxCards) || m.maxCards < 1 ||
      !Number.isSafeInteger(m.maxPerNetwork) || m.maxPerNetwork < 1 || !Number.isSafeInteger(m.maxTextBytes) || m.maxTextBytes < 1) {
      throw new RangeError('Invalid StoryLedger limits');
    }
    this.limits = Object.freeze(m);
  }

  private removeAt(i: number) { const [r] = this.entries.splice(i, 1); if (r) this.bytes -= r.card.textBytes; }
  private removeOldest(networkCode?: string): boolean {
    let idx = -1; let oldest = Infinity;
    this.entries.forEach((e, i) => {
      if (networkCode !== undefined && e.card.networkCode !== networkCode) return;
      if (e.airMs < oldest) { oldest = e.airMs; idx = i; }
    });
    if (idx < 0) return false;
    this.removeAt(idx);
    return true;
  }

  prune(nowMs: number): number {
    assertClock(nowMs);
    const cutoff = nowMs - this.limits.retentionMs;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.airMs > cutoff);
    this.bytes = this.entries.reduce((s, e) => s + e.card.textBytes, 0);
    return before - this.entries.length;
  }

  ingest(input: StoryCardInput, nowMs: number): LedgerIngestResult {
    assertClock(nowMs); // before any state change
    if (!input || typeof input.networkCode !== 'string' || !input.networkCode.trim() || typeof input.network !== 'string' || !input.network.trim() ||
      (input.sourceKind !== 'broadcast-captions' && input.sourceKind !== 'page-text') ||
      typeof input.programId !== 'string' || !input.programId.trim() || typeof input.programTitle !== 'string' ||
      !Number.isFinite(input.programStartMs) || !Number.isFinite(input.windowStartMs) || !Number.isFinite(input.startSec) || input.startSec < 0 ||
      !Number.isFinite(input.score) || typeof input.clock !== 'string' ||
      !Array.isArray(input.minutes) || input.minutes.length === 0 || input.minutes.length > MAX_MINUTES_PER_CARD) return 'rejected';
    if (input.windowStartMs > nowMs || input.windowStartMs <= nowMs - this.limits.retentionMs) return 'rejected';

    const minutes: LedgerMinute[] = [];
    let textBytes = 0;
    for (const m of input.minutes) {
      if (!m || typeof m.text !== 'string' || typeof m.clock !== 'string' || !Number.isFinite(m.startSec) || m.startSec < 0 ||
        m.text.trim().length === 0 || m.text.length > MAX_MINUTE_CHARS) return 'rejected';
      textBytes += Buffer.byteLength(m.text, 'utf8');
      minutes.push({ clock: m.clock, startSec: m.startSec, text: m.text });
    }
    if (textBytes > this.limits.maxTextBytes) return 'rejected';

    this.prune(nowMs);
    const id = `${input.networkCode}|${input.programId}|${input.startSec}`;
    if (this.entries.some((e) => e.card.id === id)) return 'duplicate';

    const tokens = tokenSet(minutes.map((m) => m.text).join(' '));
    let replaced = false;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.card.networkCode !== input.networkCode) continue;
      if (jaccard(tokens, tokenSet(cardText(e.card))) >= NEAR_DUP_JACCARD) {
        if (e.card.score >= input.score) return 'duplicate';
        this.removeAt(i);
        replaced = true;
      }
    }

    let net = this.entries.filter((e) => e.card.networkCode === input.networkCode).length;
    while (net >= this.limits.maxPerNetwork) { if (!this.removeOldest(input.networkCode)) break; net--; }
    while (this.entries.length >= this.limits.maxCards || this.bytes + textBytes > this.limits.maxTextBytes) { if (!this.removeOldest()) break; }

    const card: StoryCard = {
      id, networkCode: input.networkCode, network: input.network, sourceKind: input.sourceKind, programId: input.programId,
      programTitle: input.programTitle, programStartUtc: iso(input.programStartMs), windowStartUtc: iso(input.windowStartMs),
      startSec: input.startSec, clock: input.clock, minutes, textBytes, score: input.score, firstSeenMs: nowMs,
    };
    this.entries.push({ card, airMs: input.windowStartMs });
    this.bytes += textBytes;
    return replaced ? 'replaced' : 'added';
  }

  /** Detached copies, newest air time first. */
  snapshot(nowMs: number): StoryCard[] {
    assertClock(nowMs);
    this.prune(nowMs);
    return this.entries.slice()
      .sort((a, b) => b.airMs - a.airMs || b.card.score - a.card.score || (a.card.id < b.card.id ? -1 : 1))
      .map((e) => clone(e.card));
  }

  coverageWindow(nowMs: number): CoverageWindow {
    assertClock(nowMs);
    this.prune(nowMs);
    if (this.entries.length === 0) return { requestedHours: 24, coveredFromUtc: null, coveredToUtc: null, building: true };
    let min = Infinity; let max = -Infinity;
    for (const e of this.entries) { if (e.airMs < min) min = e.airMs; if (e.airMs > max) max = e.airMs; }
    return { requestedHours: 24, coveredFromUtc: iso(min), coveredToUtc: iso(max), building: max - min < BUILDING_SPAN_MS };
  }

  countByNetwork(nowMs: number): Map<string, number> {
    assertClock(nowMs);
    this.prune(nowMs);
    const out = new Map<string, number>();
    for (const e of this.entries) out.set(e.card.networkCode, (out.get(e.card.networkCode) ?? 0) + 1);
    return out;
  }

  clear(): void { this.entries = []; this.bytes = 0; }
  get stats() { return { cards: this.entries.length, textBytes: this.bytes, ...this.limits }; }
}

export function createStoryLedger(limits?: Partial<LedgerLimits>): StoryLedger { return new StoryLedger(limits); }
