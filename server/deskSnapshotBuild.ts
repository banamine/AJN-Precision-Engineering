/* Builds / refreshes the snapshot: runs the normal desk build, saves each card's small page image as a file, merges with the
 * previous snapshot and writes desk.json. Used by scripts/build-desk-snapshot.ts (a GitHub Action or your own machine). */
import { buildDesk, DESK_BEATS, type DeskCollection, type DeskFeed, type DeskItem } from './desk';
import { isValidFeed, mergeFeeds, thumbFileName, THUMB_DIR, SNAPSHOT_PATH } from './deskSnapshot';

export interface SnapshotFs {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
export interface SnapshotDeps { fetchImpl: typeof fetch; lib: DeskCollection[]; fs: SnapshotFs; perBeat?: number; maxAttempts?: number; now?: () => Date; log?: (m: string) => void }
export interface SnapshotResult { feed: DeskFeed; newItems: number; thumbsSaved: number; thumbsFailed: number }

const looksJpeg = (b: Uint8Array): boolean => b.length > 800 && b[0] === 0xff && b[1] === 0xd8;

async function saveThumb(d: SnapshotDeps, item: DeskItem): Promise<'saved' | 'kept' | 'failed'> {
  const name = thumbFileName(item.id); const rel = `${THUMB_DIR}/${name}`;
  if (await d.fs.exists(rel)) return 'kept';
  try {
    const res = await d.fetchImpl(item.thumbUrl, { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0' }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return 'failed';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!looksJpeg(bytes)) return 'failed';
    await d.fs.write(rel, bytes); return 'saved';
  } catch { return 'failed'; }
}

export async function makeSnapshot(d: SnapshotDeps): Promise<SnapshotResult> {
  const log = d.log ?? (() => {});
  let old: DeskFeed | null = null;
  try { const raw = await d.fs.read(SNAPSHOT_PATH); if (raw) { const j = JSON.parse(new TextDecoder().decode(raw)); if (isValidFeed(j)) old = j; } } catch { old = null; }
  const fresh = await buildDesk({ fetchImpl: d.fetchImpl, lib: d.lib, perBeat: d.perBeat ?? 25, maxAttempts: d.maxAttempts ?? 60, now: d.now });
  log(`built ${fresh.count} cards`);
  if (fresh.count === 0) throw new Error('the build produced no cards; the existing snapshot was left untouched');
  let saved = 0, failed = 0;
  const items: DeskItem[] = [];
  for (const item of fresh.items) {
    const r = await saveThumb(d, item);
    if (r === 'failed') { failed++; items.push(item); continue; } // keep the card; its image address stays as the live one
    if (r === 'saved') saved++;
    items.push({ ...item, thumbUrl: `/${THUMB_DIR}/${thumbFileName(item.id)}` });
  }
  const oldIds = new Set(old?.items.map((i) => i.id) ?? []);
  const merged = mergeFeeds(old, { ...fresh, items, count: items.length }, DESK_BEATS);
  await d.fs.write(SNAPSHOT_PATH, JSON.stringify(merged));
  return { feed: merged, newItems: items.filter((i) => !oldIds.has(i.id)).length, thumbsSaved: saved, thumbsFailed: failed };
}
