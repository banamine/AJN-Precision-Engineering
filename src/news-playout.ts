/**
 * Archive.org TV News playout policy.
 * Purpose: keep a channel supplied from existing recordings without hammering IA.
 */
export const NEWS_PLAYOUT = {
  maxAssets: 50,
  metadataConcurrency: 4,
  retryAttempts: 3,
  retryBackoffMs: 750,
  preferredLookbackDays: 14,
  fallbackLookbackDays: 90,
  cacheTtlMs: 30 * 60 * 1000,
  loop: true,
  shuffle: false,
} as const;

export function nextNewsIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return (current + 1) % length;
}
