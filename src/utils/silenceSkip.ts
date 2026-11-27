/* Skip silence for spoken, on-demand audio (podcasts). Pure decision logic; the hook below feeds it real analyser levels.
 *
 * It does NOT cut or seek: when a pause has lasted ENGAGE_AFTER_MS it plays the rest of the pause at SKIP_RATE (pitch-preserving), and returns to the
 * normal rate the moment sound is back. So currentTime stays continuous: captions, resume position, Watch Later and ad-skip all stay in step, and the
 * first half second of every pause is kept (natural phrasing). Never in the first/last EDGE_GUARD_SEC, never while buffering/seeking/paused/muted. */
export const SILENCE_DB = -50;          // below this the frame counts as silence (RMS dBFS, after compensating the element volume)
export const SOUND_DB = -46;            // back above this = sound is back (hysteresis: no flutter at the threshold)
export const ENGAGE_AFTER_MS = 500;
export const SKIP_RATE = 4;
export const EDGE_GUARD_SEC = 10;
export const SKIP_STORAGE_KEY = 'ajn.skipSilence.v1';

export interface SkipFrame { db: number; nowMs: number; position: number; duration: number; rate: number; ready: boolean; muted: boolean }
export class SilenceSkipper {
  private silentSince: number | null = null;
  private restRate = 1;
  active = false;
  /** Returns the playbackRate to set, or null for "leave it". */
  step(f: SkipFrame): number | null {
    const guarded = !f.ready || f.muted || !Number.isFinite(f.duration) || f.duration <= 0 || f.position < EDGE_GUARD_SEC || f.position > f.duration - EDGE_GUARD_SEC;
    if (guarded) return this.release();
    if (f.db < SILENCE_DB) {
      if (this.silentSince === null) this.silentSince = f.nowMs;
      if (!this.active && f.nowMs - this.silentSince >= ENGAGE_AFTER_MS) { this.active = true; this.restRate = f.rate > 0 && f.rate < SKIP_RATE ? f.rate : 1; return SKIP_RATE; }
      return null;
    }
    if (f.db > SOUND_DB) { this.silentSince = null; return this.release(); }
    return null;
  }
  release(): number | null { this.silentSince = null; if (!this.active) return null; this.active = false; return this.restRate; }
}
/** The analyser may sit after the element volume: scale the level back up so a quiet slider is never mistaken for silence. (If it sits before, this only makes us skip LESS.) */
export const compensateDb = (db: number, elementVolume: number): number => db - 20 * Math.log10(Math.max(0.01, Math.min(1, elementVolume)));
export const loadSkipSetting = (s: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean => { try { return s?.getItem(SKIP_STORAGE_KEY) === '1'; } catch { return false; } };
export const saveSkipSetting = (on: boolean, s: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void => { try { s?.setItem(SKIP_STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode: off next visit */ } };
