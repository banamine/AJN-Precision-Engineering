/** Real cover art for an Archive audio file: images that sit in the same folder as the track
 *  (cover.jpg, folder.jpg, band photos…), taken from the item's own file list. Nothing invented:
 *  no images in the folder → an empty list and the player shows no art. */
import type { Express } from 'express';

const IMG = /\.(jpe?g|png|webp)$/i;
const PREFERRED = /(cover|folder|front|album|artwork|poster|band|artist|logo)/i;
const MIN_BYTES = 5_000;            // skip icons/spacers
const MAX_IMAGES = 3;
const TTL_MS = 60 * 60 * 1000;
const MAX_ITEMS = 12;               // big items (17k files) are indexed to images only

type Index = Map<string, { name: string; size: number }[]>;
const cache = new Map<string, { expires: number; index: Index }>();
const inflight = new Map<string, Promise<Index>>();

export function parseDownloadPath(raw: string): { id: string; file: string } | null {
  let p = String(raw || '');
  try { p = decodeURIComponent(p); } catch { return null; }
  const m = /^\/download\/([A-Za-z0-9._-]+)\/(.+)$/.exec(p);
  if (!m || m[2].includes('..')) return null;
  return { id: m[1], file: m[2] };
}

export function folderOf(file: string): string { const i = file.lastIndexOf('/'); return i < 0 ? '' : file.slice(0, i); }

/** Same folder first, then the parent (a CD1/CD2 layout) — never the item root, which would be unrelated art. */
export function pickImages(index: Index, file: string): { folder: string; names: string[] } | null {
  let folder = folderOf(file);
  for (let hop = 0; hop < 2 && folder; hop += 1) {
    const imgs = index.get(folder);
    if (imgs?.length) {
      const ranked = [...imgs].sort((a, b) => Number(PREFERRED.test(b.name)) - Number(PREFERRED.test(a.name)) || b.size - a.size || a.name.localeCompare(b.name));
      return { folder, names: ranked.slice(0, MAX_IMAGES).map((i) => i.name) };
    }
    folder = folderOf(folder);
  }
  return null;
}

async function loadIndex(id: string): Promise<Index> {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.index;
  let p = inflight.get(id);
  if (!p) {
    p = (async () => {
      const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'AJN-Precision-Engineering/FolderArt', Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`metadata HTTP ${r.status}`);
      const meta = await r.json() as { files?: { name?: string; size?: string }[]; is_dark?: boolean };
      if (meta.is_dark) throw new Error('item unavailable');
      const index: Index = new Map();
      for (const f of meta.files ?? []) {
        const name = f.name ?? '';
        if (!IMG.test(name) || name.includes('.thumbs/') || /__ia_thumb/i.test(name)) continue;
        const size = Number(f.size) || 0;
        if (size < MIN_BYTES) continue;
        const folder = folderOf(name);
        const arr = index.get(folder) ?? [];
        arr.push({ name: name.slice(folder ? folder.length + 1 : 0), size });
        index.set(folder, arr);
      }
      if (cache.size >= MAX_ITEMS) cache.clear();
      cache.set(id, { expires: Date.now() + TTL_MS, index });
      return index;
    })().finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function registerFolderArtRoute(app: Express): void {
  app.get('/api/archive/folder-art', async (req, res) => {
    const parsed = parseDownloadPath(String(req.query.path ?? ''));
    if (!parsed) return res.status(400).json({ error: 'path must be /download/<identifier>/<file>' });
    try {
      const index = await loadIndex(parsed.id);
      const pick = pickImages(index, parsed.file);
      const images = (pick?.names ?? []).map((name) => ({
        name,
        url: `/api/archive/proxy?path=${encodeURIComponent(`/download/${parsed.id}/${pick!.folder ? `${pick!.folder}/` : ''}${name}`)}`,
      }));
      res.set('Cache-Control', 'public, max-age=3600').json({ images });
    } catch (e: any) {
      res.set('Cache-Control', 'no-store').status(502).json({ error: `art lookup failed: ${e?.message ?? e}` });
    }
  });
}
