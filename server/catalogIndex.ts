/**
 * Read-only query layer over the offline Archive catalog snapshot (src/data/archiveCatalog.json,
 * built by scripts/archive-catalog.ts). No network calls: the snapshot is the source of truth.
 */
export type CatalogEntry = {
  id: string; sourceUrl: string; displayTitle: string; originalTitle: string; genres: string[];
  mediaType: 'video' | 'audio' | 'collection' | 'other'; status: 'playable' | 'not-playable' | 'collection';
  year?: number; creator?: string; thumbnailUrl?: string; reason?: string;
  selected?: { path: string; name: string; format: string; sizeBytes?: number; durationSeconds?: number; durationEstimated?: boolean };
  playableFileCount?: number; episodeCount?: number;
};
export type CatalogQuery = { q?: string; genre?: string; kind?: string; status?: string; page?: number; limit?: number };

type Loaded = { items: CatalogEntry[]; search: string[]; generatedAt: string; collections: Map<string, { memberCount: number; expanded: boolean }> };
let loaded: Promise<Loaded> | null = null;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function loadCatalog(): Promise<Loaded> {
  if (!loaded) {
    loaded = (async () => {
      const mod: any = await import('../src/data/archiveCatalog.json');
      const d = mod.default ?? mod;
      const items: CatalogEntry[] = d.items ?? [];
      const collections = new Map<string, { memberCount: number; expanded: boolean }>();
      for (const c of d.collections ?? []) collections.set(c.id, { memberCount: c.memberCount, expanded: !!c.expanded });
      return { items, collections, generatedAt: d.generatedAt, search: items.map((i) => norm(`${i.displayTitle} ${i.originalTitle} ${i.creator ?? ''} ${i.genres.join(' ')} ${i.id}`)) };
    })();
    loaded.catch(() => { loaded = null; }); // a failed load must surface and be retried, never cached as "empty"
  }
  return loaded;
}

/** status: 'playable' (default) | 'not-playable' | 'collection' | 'all'. kind: 'video' | 'audio' | ''. */
export async function queryCatalog(p: CatalogQuery) {
  const c = await loadCatalog();
  const status = p.status || 'playable';
  const tokens = norm(p.q ?? '').split(/\s+/).filter(Boolean);
  const base: number[] = [];
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i];
    if (status !== 'all' && it.status !== status) continue;
    if (p.kind && it.mediaType !== p.kind) continue;
    if (tokens.length && !tokens.every((t) => c.search[i].includes(t))) continue;
    base.push(i);
  }
  const facets = new Map<string, number>();
  for (const i of base) for (const g of c.items[i].genres) facets.set(g, (facets.get(g) ?? 0) + 1);
  const rows = p.genre ? base.filter((i) => c.items[i].genres.includes(p.genre!)) : base;
  rows.sort((a, b) => c.items[a].displayTitle.localeCompare(c.items[b].displayTitle, 'en', { sensitivity: 'base', numeric: true }));
  const limit = Math.min(100, Math.max(1, p.limit || 24));
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(Math.max(1, p.page || 1), totalPages);
  const items = rows.slice((page - 1) * limit, page * limit).map((i) => {
    const it = c.items[i];
    return it.status === 'collection' ? { ...it, ...(c.collections.get(it.id) ?? {}) } : it;
  });
  return { page, totalPages, totalItems: rows.length, generatedAt: c.generatedAt,
    genres: [...facets].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre)), items };
}

export async function catalogStats() {
  const c = await loadCatalog();
  const by = (f: (i: CatalogEntry) => string) => c.items.reduce<Record<string, number>>((m, i) => { const k = f(i); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { generatedAt: c.generatedAt, total: c.items.length, byStatus: by((i) => i.status), byMediaType: by((i) => i.mediaType) };
}
