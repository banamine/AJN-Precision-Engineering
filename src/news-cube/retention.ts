export const CUBE_FRESHNESS_MS = 48 * 60 * 60 * 1000;
export const CUBE_FUTURE_SKEW_MS = 10 * 60 * 1000;

export type PublicationWindow =
  | { kind: 'eligible'; publishedMs: number }
  | { kind: 'no-date' }
  | { kind: 'outside-window' };

/** Applies the 48-hour read-time window; it never deletes or persists a shared record. */
export function classifyPublicationTime(value: unknown, now: number): PublicationWindow {
  if (typeof value !== 'string' || !value.trim()) return { kind: 'no-date' };
  const publishedMs = Date.parse(value);
  if (!Number.isFinite(publishedMs)) return { kind: 'no-date' };
  const age = now - publishedMs;
  if (age > CUBE_FRESHNESS_MS || age < -CUBE_FUTURE_SKEW_MS) return { kind: 'outside-window' };
  return { kind: 'eligible', publishedMs };
}
