/**
 * Pure channel picker for the YouTube wall's default panels.
 * Draws up to `count` distinct entries using a partial Fisher-Yates shuffle.
 * `rng` is injectable (returns a number in [0, 1)); it defaults to Math.random.
 * The input array is never mutated.
 */
export function pickRandomChannels<T>(
  channels: readonly T[],
  count: number,
  rng: () => number = Math.random,
): T[] {
  const size = Math.max(0, Math.min(Math.floor(count) || 0, channels.length));
  const pool = channels.slice();
  for (let i = 0; i < size; i++) {
    const raw = rng();
    const unit = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.9999999999) : 0;
    const j = i + Math.floor(unit * (pool.length - i));
    const held = pool[i];
    pool[i] = pool[j];
    pool[j] = held;
  }
  return pool.slice(0, size);
}
