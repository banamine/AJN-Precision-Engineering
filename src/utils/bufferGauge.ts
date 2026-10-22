export type BufferHealth = "filling" | "steady" | "draining" | "underrun" | "idle";

export interface BufferGaugeMetadata {
  bytes?: number;
  durationSeconds?: number;
}

export interface BufferGaugeSample {
  /** Monotonic milliseconds from the current process/browser time origin. */
  t: number;
  currentTime: number;
  bufferedEnd: number;
  readyState: number;
  paused: boolean;
  waiting: boolean;
}

export interface BufferGaugeSnapshot {
  aheadSeconds: number;
  fillRateSecondsPerSecond: number;
  fillRateRatio: number | null;
  drainRate: number;
  underrunCount: number;
  longestUnderrunMs: number;
  health: BufferHealth;
  underrunActive: boolean;
  kbps: number | null;
  sliceIndex: number | null;
  currentTime: number;
  windowSpanMs: number;
}

export interface BufferGaugeOptions extends BufferGaugeMetadata {
  now?: () => number;
}

const FILL_WINDOW_MS = 15_000;
const FILLING_RATE = 1.05;
const FILLING_EXIT_RATE = 1.0;
const DRAINING_RATE = 0.9;
const DRAINING_EXIT_RATE = 1.0;
const LOW_BUFFER_SECONDS = 20;
const LOW_BUFFER_EXIT_SECONDS = 22;
const EIGHT_MIB_BITS = 8 * 1024 * 1024 * 8;

// Health thresholds use measured buffer-growth / media-time drain ratio:
// filling above 1.05x; draining below 0.9x for a full 15-second window while
// less than 20 seconds remain; waiting/readyState < 3
// while playing is underrun; paused is idle; all remaining active states steady.
// Hysteresis prevents noisy 1-second samples from flipping states: filling
// remains until <=1.0x, and draining remains until >=1.0x or 22s of headroom.

/** Accept only numeric program metadata; unknown or partial metadata stays unknown. */
export function bufferGaugeMetadata(value: unknown): BufferGaugeMetadata | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const result: BufferGaugeMetadata = {};
  if (typeof fields.bytes === "number" && Number.isFinite(fields.bytes) && fields.bytes > 0) {
    result.bytes = fields.bytes;
  }
  if (typeof fields.durationSeconds === "number" && Number.isFinite(fields.durationSeconds) && fields.durationSeconds > 0) {
    result.durationSeconds = fields.durationSeconds;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Pure per-item buffer estimator. A new instance is created when the playing
 * item changes; seeks/discontinuities clear only the 15-second fill-rate window.
 */
export function createBufferGauge(options: BufferGaugeOptions = {}) {
  const now = options.now ?? Date.now;
  const metadata = bufferGaugeMetadata(options);
  const kbps = metadata?.bytes !== undefined && metadata.durationSeconds !== undefined
    ? metadata.bytes * 8 / metadata.durationSeconds / 1000
    : null;
  const secondsPerEightMiB = kbps !== null && kbps > 0 ? EIGHT_MIB_BITS / (kbps * 1000) : null;
  let window: Array<{ t: number; bufferedEnd: number }> = [];
  let previous: BufferGaugeSample | null = null;
  let currentTime = 0;
  let aheadSeconds = 0;
  let fillRateSecondsPerSecond = 0;
  let fillRateRatio: number | null = null;
  let drainRate = 0;
  let windowSpanMs = 0;
  let health: BufferHealth = "idle";
  let underrunCount = 0;
  let underrunStartedAt: number | null = null;
  let longestUnderrunMs = 0;
  let underrunActive = false;

  const snapshot = (): BufferGaugeSnapshot => ({
    aheadSeconds,
    fillRateSecondsPerSecond,
    drainRate,
    fillRateRatio,
    underrunCount,
    longestUnderrunMs: underrunStartedAt === null
      ? longestUnderrunMs
      : Math.max(longestUnderrunMs, Math.max(0, now() - underrunStartedAt)),
    health,
    underrunActive,
    kbps,
    sliceIndex: secondsPerEightMiB === null ? null : Math.floor(currentTime / secondsPerEightMiB),
    currentTime,
    windowSpanMs,
  });

  const push = (sample: BufferGaugeSample): BufferGaugeSnapshot => {
    if (
      !Number.isFinite(sample.t)
      || !Number.isFinite(sample.currentTime) || sample.currentTime < 0
      || !Number.isFinite(sample.bufferedEnd) || sample.bufferedEnd < 0
      || !Number.isFinite(sample.readyState)
      || typeof sample.paused !== "boolean"
      || typeof sample.waiting !== "boolean"
    ) return snapshot();

    const time = sample.t;
    let discontinuity = false;
    let elapsedSeconds = 0;
    let mediaDelta = 0;
    if (previous) {
      elapsedSeconds = Math.max(0, (time - previous.t) / 1000);
      mediaDelta = sample.currentTime - previous.currentTime;
      discontinuity = time <= previous.t || mediaDelta < -1 || Math.abs(mediaDelta - elapsedSeconds) > 3;
      if (discontinuity) {
        window = [];
        windowSpanMs = 0;
      }
    }

    currentTime = sample.currentTime;
    aheadSeconds = Math.max(0, sample.bufferedEnd - sample.currentTime);
    window.push({ t: time, bufferedEnd: sample.bufferedEnd });
    const cutoff = time - FILL_WINDOW_MS;
    // Keep the sample before cutoff as a bracket, then interpolate the
    // buffered-end value at the exact 15-second boundary.
    while (window.length > 2 && window[1].t < cutoff) window.shift();
    const first = window[0];
    const last = window[window.length - 1];
    const next = window[1];
    let startBufferedEnd = first.bufferedEnd;
    if (first.t < cutoff && next && next.t >= cutoff && next.t > first.t) {
      const ratio = (cutoff - first.t) / (next.t - first.t);
      startBufferedEnd = first.bufferedEnd + (next.bufferedEnd - first.bufferedEnd) * ratio;
      windowSpanMs = time - cutoff;
    } else {
      windowSpanMs = Math.max(0, last.t - first.t);
    }
    const spanMs = windowSpanMs;
    fillRateSecondsPerSecond = spanMs > 0
      ? Math.max(0, (last.bufferedEnd - startBufferedEnd) / (spanMs / 1000))
      : 0;

    const playing = !sample.paused;
    // The gauge contract compares fill against normal 1x playback; paused
    // media has no active drain. Keep discontinuity tracking separate.
    drainRate = playing ? 1 : 0;
    fillRateRatio = drainRate > 0 ? fillRateSecondsPerSecond / drainRate : null;
    const active = playing && !discontinuity && (sample.waiting || sample.readyState < 3);
    if (active && underrunStartedAt === null) {
      underrunStartedAt = time;
      underrunCount += 1;
    } else if (!active && underrunStartedAt !== null) {
      longestUnderrunMs = Math.max(longestUnderrunMs, Math.max(0, time - underrunStartedAt));
      underrunStartedAt = null;
    }
    underrunActive = active;

    if (!playing) health = "idle";
    else if (active) health = "underrun";
    else if ((fillRateRatio ?? 0) > (health === "filling" ? FILLING_EXIT_RATE : FILLING_RATE)) health = "filling";
    else if (
      spanMs >= FILL_WINDOW_MS
      && fillRateRatio !== null
      && fillRateRatio < (health === "draining" ? DRAINING_EXIT_RATE : DRAINING_RATE)
      && aheadSeconds < (health === "draining" ? LOW_BUFFER_EXIT_SECONDS : LOW_BUFFER_SECONDS)
    ) health = "draining";
    else health = "steady";

    previous = { ...sample };
    return snapshot();
  };

  return { push, snapshot };
}
