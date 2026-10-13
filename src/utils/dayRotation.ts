// Deterministic daily rotation. The same local date always gives the same picks; the picks change at the viewer's
// local midnight. No Math.random: the order comes from a hash of (date, salt, item id).

/** "2026-10-11" in the viewer's LOCAL calendar (not UTC), so the rotation flips at the viewer's midnight. */
export function localDateKey(d: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Stable order of the pool for this date + salt (independent of the input order). */
export function dailyOrder<T>(pool: readonly T[], idOf: (t: T) => string, dateKey: string, salt = ''): T[] {
  return [...pool].sort((a, b) => {
    const ha = hash32(`${dateKey}|${salt}|${idOf(a)}`);
    const hb = hash32(`${dateKey}|${salt}|${idOf(b)}`);
    return ha - hb || idOf(a).localeCompare(idOf(b));
  });
}

export function pickForDay<T>(pool: readonly T[], idOf: (t: T) => string, dateKey: string, count: number, salt = ''): T[] {
  return dailyOrder(pool, idOf, dateKey, salt).slice(0, Math.max(0, count));
}

/** Milliseconds until the viewer's next local midnight (for a single re-render timer). */
export function msUntilLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}
