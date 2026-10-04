/** Build src/data/archiveCatalog.json from an Archive.org account: its uploads, its favorites, and the members of favorited
 *  collections that are small enough (EXPAND_LIMIT, default 200). Links and metadata only: no media is downloaded.
 *
 *  Run:  ARCHIVE_UPLOADER_EMAIL=<account email> npm run catalog:build      (then commit + push the JSON)
 *  Env:  ARCHIVE_ACCOUNT   screen name, default "infobattalion" (favorites = collection fav-<name>)
 *        ARCHIVE_UPLOADER_EMAIL   REQUIRED: the Archive search can only list uploads by the account's email. Never written anywhere.
 *        EXPAND_LIMIT      expand a favorited collection only if it has at most this many members (default 200)
 *        CATALOG_CACHE     resumable metadata cache (ndjson), default .cache/archive-catalog-meta.ndjson (git-ignored)
 *        CATALOG_OUT       output file, default src/data/archiveCatalog.json
 *  Per-item failures never stop the run: they are listed under "incomplete" in the output. */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { archiveApiFetch } from '../server/archiveLimiter';
import { searchAll, countMembers, fetchItemMetadata } from '../server/catalog/enumerate';
import { buildCatalogRecord, mergeSources, type CatalogRecord, type CatalogSource } from '../server/catalog/record';
import { dedupeRecords } from '../server/catalog/dedupe';

const account = (process.env.ARCHIVE_ACCOUNT || 'infobattalion').trim();
const email = (process.env.ARCHIVE_UPLOADER_EMAIL || '').trim();
const limit = Math.max(1, Number(process.env.EXPAND_LIMIT) || 200);
const cachePath = process.env.CATALOG_CACHE || '.cache/archive-catalog-meta.ndjson';
const outUrl = new URL(`../${process.env.CATALOG_OUT || 'src/data/archiveCatalog.json'}`, import.meta.url);
if (!email) { console.error('ARCHIVE_UPLOADER_EMAIL is not set. The Archive lists an account\'s uploads only by its email address. Set it in this shell only; it is never written to a file.'); process.exit(2); }

const log = (s: string) => console.log(`[catalog] ${s}`);
const fetcher = archiveApiFetch;
const sources = new Map<string, CatalogSource[]>();
const addSource = (id: string, s: CatalogSource) => sources.set(id, mergeSources(sources.get(id) ?? [], [s]));
const titles = new Map<string, string>();

// 1. Favorites, uploads
const fav = await searchAll(fetcher, `collection:fav-${account}`);
log(`favorites: ${fav.docs.length} of ${fav.numFound}`);
const up = await searchAll(fetcher, `uploader:"${email}"`);
log(`uploads: ${up.docs.length} of ${up.numFound}`);
for (const d of fav.docs) { addSource(d.identifier, { kind: 'favorite' }); if (d.title) titles.set(d.identifier, String(d.title)); }
for (const d of up.docs) { addSource(d.identifier, { kind: 'upload' }); if (d.title) titles.set(d.identifier, String(d.title)); }

// 2. Favorited collections: expand only the small ones
const collections: Array<{ id: string; title?: string; memberCount: number | null; expanded: boolean; reason?: string }> = [];
const incomplete: Array<{ id: string; status: string; reason: string }> = [];
const favCollections = fav.docs.filter((d) => d.mediatype === 'collection');
for (const c of favCollections) {
  try {
    const n = await countMembers(fetcher, c.identifier);
    if (n > limit) { collections.push({ id: c.identifier, title: c.title, memberCount: n, expanded: false, reason: `${n} members is over the limit of ${limit}` }); continue; }
    const members = await searchAll(fetcher, `collection:"${c.identifier}"`);
    for (const m of members.docs) { addSource(m.identifier, { kind: 'collection', via: c.identifier }); if (m.title) titles.set(m.identifier, String(m.title)); }
    collections.push({ id: c.identifier, title: c.title, memberCount: n, expanded: true });
  } catch (e: any) {
    collections.push({ id: c.identifier, title: c.title, memberCount: null, expanded: false, reason: `expansion failed: ${e?.message}` });
    incomplete.push({ id: c.identifier, status: 'collection-not-expanded', reason: String(e?.message ?? e).slice(0, 160) });
  }
}
log(`collections: ${favCollections.length} favorited, ${collections.filter((c) => c.expanded).length} expanded (limit ${limit}), ${collections.filter((c) => !c.expanded).length} not expanded`);

// 3. Metadata for every non-collection identifier, resumable
const cache = new Map<string, any>();
if (existsSync(cachePath)) for (const line of readFileSync(cachePath, 'utf8').split('\n')) { if (!line) continue; try { const o = JSON.parse(line); cache.set(o.id, o.meta); } catch { /* skip a torn last line */ } }
const collectionIds = new Set(favCollections.map((c) => c.identifier));
const ids = [...sources.keys()].filter((id) => !collectionIds.has(id)).sort();
log(`metadata: ${ids.length} items, ${cache.size} already cached`);
mkdirSync(dirname(cachePath), { recursive: true });
const failed = new Map<string, string>();
let done = 0, next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    if (!cache.has(id)) {
      const r = await fetchItemMetadata(fetcher, id);
      if (r.ok) { cache.set(id, r.meta); appendFileSync(cachePath, JSON.stringify({ id, meta: r.meta }) + '\n'); }
      else failed.set(id, (r as { ok: false; reason: string }).reason);
    }
    if (++done % 200 === 0) log(`  ${done}/${ids.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// 4. Records
const records: CatalogRecord[] = []; const excluded: Array<{ id: string; reason: string }> = [];
for (const id of ids) {
  if (failed.has(id)) { incomplete.push({ id, status: 'metadata-failed', reason: failed.get(id)! }); continue; }
  const r = buildCatalogRecord(id, cache.get(id), sources.get(id)!);
  if (r.kind === 'record') records.push(r.record);
  else if (r.kind === 'excluded') excluded.push({ id: r.id, reason: r.reason });
  else incomplete.push({ id: r.id, status: 'unavailable', reason: r.reason });
}
for (const c of favCollections) {                                      // the favorited collections themselves are browsable entries
  const info = collections.find((x) => x.id === c.identifier)!;
  records.push({ id: c.identifier, sourceUrl: `https://archive.org/details/${encodeURIComponent(c.identifier)}`, sources: sources.get(c.identifier)!,
    displayTitle: (c.title ? String(c.title) : c.identifier), originalTitle: c.title ? String(c.title) : c.identifier, genres: ['Uncategorized'],
    archiveMediatype: 'collection', mediaType: 'collection', status: 'collection',
    thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(c.identifier)}`, thumbnailSource: 'archive-service',
    collection: { memberCount: info.memberCount ?? 0, expanded: info.expanded, reason: info.reason } });
}
const { englishLabel } = await import('../server/catalog/rules');
for (const r of records) if (r.mediaType === 'collection') r.displayTitle = englishLabel(r.originalTitle, r.id);

// 5. Dedupe + write
const dd = dedupeRecords(records);
const byStatus: Record<string, number> = {}; for (const r of dd.records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
const catalog = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  source: { account, favorites: fav.docs.length, uploads: up.docs.length, uploadsQuery: 'uploader:<redacted>', collectionExpandLimit: limit },
  collections, stats: { records: dd.records.length, ...byStatus, exactDuplicatesMerged: dd.exactMerged.length, likelyDuplicateGroups: dd.reviews.length, excludedByRule: excluded.length, incomplete: incomplete.length },
  exactDuplicates: dd.exactMerged, reviews: dd.reviews, excluded, incomplete, items: dd.records,
};
const json = JSON.stringify(catalog);
if (json.toLowerCase().includes(email.toLowerCase())) { console.error('Refusing to write: the uploader email appears in the output.'); process.exit(3); }
const tmp = new URL(outUrl.href + '.tmp'); writeFileSync(tmp, json); renameSync(tmp, outUrl);
log(`wrote ${outUrl.pathname}: ${JSON.stringify(catalog.stats)}`);
process.exit(0);
