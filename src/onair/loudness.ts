/* Build 19: keeps the loudness of the on-air sources close together.
 * The analyser tap (captureStream) hears the on-air deck BEFORE the element volume, so we can measure the source's own level (RMS in dBFS),
 * remember it per source, and scale that deck's volume toward one common target. Volume can only be lowered (element volume tops out at 1.0),
 * so loud sources (music) are pulled down to the level of quiet ones (news); nothing is ever boosted. Pure functions, no DOM. */
export const TARGET_DB = -24;       // common target level (RMS, dBFS)
export const GATE_DB = -55;         // frames quieter than this are silence and are not counted
export const MIN_HEARD_SEC = 5;     // seconds of real sound before a measurement is trusted
export const MIN_TRIM = 0.08;       // never attenuate by more than ~22 dB
export const SLEW_DB_PER_SEC = 4;   // how fast the applied trim moves toward its target (no sudden jumps)
const TAU_SEC = 15;

export function rmsDb(samples: ArrayLike<number>): number {
  let s = 0; const n = samples.length;
  if (n === 0) return -120;
  for (let i = 0; i < n; i++) s += samples[i] * samples[i];
  const rms = Math.sqrt(s / n);
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
}

export class LevelEstimator {
  private sum = 0; private w = 0; private heard = 0; // sum of POWER (energy mean, closer to how loudness is heard than a mean of dB)
  add(db: number, dtSec: number): void {
    if (!(db > GATE_DB) || !(dtSec > 0)) return;
    const decay = Math.exp(-dtSec / TAU_SEC);
    this.w = this.w * decay + dtSec; this.sum = this.sum * decay + Math.pow(10, db / 10) * dtSec; this.heard += dtSec;
  }
  get heardSec(): number { return this.heard; }
  /** Average level in dBFS, or null until enough real sound has been heard. */
  get(): number | null { return this.heard >= MIN_HEARD_SEC && this.w > 0 ? 10 * Math.log10(this.sum / this.w) : null; }
}

/** Linear volume multiplier (<= 1) that brings a source measured at `db` to the target level. */
export function trimFor(db: number, target: number = TARGET_DB): number {
  const t = Math.pow(10, (target - db) / 20);
  return t > 1 ? 1 : t < MIN_TRIM ? MIN_TRIM : t;
}

/** One step of the slew: move `applied` toward `target` by at most SLEW_DB_PER_SEC * dtSec (in dB). */
export function slewTrim(applied: number, target: number, dtSec: number): number {
  if (applied <= 0) return target;
  const stepDb = SLEW_DB_PER_SEC * dtSec;
  const diffDb = 20 * Math.log10(target / applied);
  if (Math.abs(diffDb) <= stepDb) return target;
  return applied * Math.pow(10, (Math.sign(diffDb) * stepDb) / 20);
}

/** Which remembered level a deck belongs to: one per podcast/filler show, one for live music, one for library music. */
export function levelKey(kind: 'podcast' | 'live' | 'library' | null, loadedItem: string | null): string | null {
  if (kind === 'live' || kind === 'library') return kind;
  if (kind === 'podcast' && loadedItem) return `podcast:${loadedItem.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return null;
}

/** Starting guess for sources with no remembered level yet (typical mastered music sits near -14 dBFS RMS); real measurement replaces it within seconds. */
export const DEFAULT_LEVEL_DB: Record<string, number> = { live: -14, library: -14 };
