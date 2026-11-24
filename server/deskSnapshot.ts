/* Declassified Desk snapshot: the built cards are saved as desk.json (plus small thumbnail files) and committed to the repo,
 * so a cold start never waits on Archive.org. Pure helpers only; no network or disk here. */
import type { DeskFeed, DeskItem, DeskBeat } from './desk';

export const SNAPSHOT_MAX_ITEMS = 300;
export const STALE_AFTER_DAYS = 10;
export const SNAPSHOT_PATH = 'desk/desk.json';
export const THUMB_DIR = 'desk/thumbs';

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function isValidItem(x: unknown): x is DeskItem {
  const i = x as DeskItem;
  return !!i && typeof i === 'object' && isStr(i.id) && isStr(i.beat) && isStr(i.headline) && (i.cardType === 'story' || i.cardType === 'scan')
    && (i.cardType === 'scan' || isStr(i.lead)) && isStr(i.thumbUrl) && isStr(i.pageUrl) && i.confidence && isStr(i.confidence.label);
}
/** A feed is usable only if it has a timestamp and at least one valid card. A snapshot that fails this is ignored, never served half-broken. */
export function isValidFeed(x: unknown): x is DeskFeed {
  const f = x as DeskFeed;
  return !!f && typeof f === 'object' && isStr(f.generatedAt) && Number.isFinite(Date.parse(f.generatedAt)) && Array.isArray(f.items) && f.items.length > 0 && f.items.every(isValidItem);
}

export const thumbFileName = (id: string): string => `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.jpg`;
export const THUMB_NAME_RE = /^[A-Za-z0-9._-]{1,200}\.jpg$/;

/** Newest valid feed among the candidates (bundled copy, GitHub copy). */
export function freshest(candidates: Array<DeskFeed | null | undefined>): DeskFeed | null {
  const ok = candidates.filter((c): c is DeskFeed => isValidFeed(c));
  if (!ok.length) return null;
  return ok.reduce((a, b) => (Date.parse(b.generatedAt) > Date.parse(a.generatedAt) ? b : a));
}
export function ageDays(feed: Pick<DeskFeed, 'generatedAt'>, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(feed.generatedAt)) / 86_400_000));
}

/** Grow the snapshot: fresh cards win over old ones with the same id; old cards that were not seen again are kept (newest first), up to the cap. */
export function mergeFeeds(old: DeskFeed | null, fresh: DeskFeed, beatMeta: Array<{ id: string; label: string; enabled: boolean }>): DeskFeed {
  const seen = new Set<string>(); const items: DeskItem[] = [];
  for (const i of [...fresh.items, ...(old && isValidFeed(old) ? old.items : [])]) { if (!seen.has(i.id)) { seen.add(i.id); items.push(i); } }
  const capped = items.slice(0, SNAPSHOT_MAX_ITEMS);
  const beats: DeskBeat[] = beatMeta.map((b) => ({ id: b.id, label: b.label, enabled: b.enabled, count: capped.filter((i) => i.beat === b.id).length }));
  return { ...fresh, beats, count: capped.length, items: capped };
}
