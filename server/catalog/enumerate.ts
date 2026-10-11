/* Archive enumeration for the offline catalog job. All network goes through an injected fetch
 * (the job passes the shared limiter, tests pass a fake), so this file never makes its own Archive traffic.
 * The Archive answers HTTP 200 with an "error" field for bad queries and deep paging: both are treated as failures here. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface SearchDoc { identifier: string; mediatype?: string; title?: string }
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getJson(f: Fetcher, url: string, sleep: (ms: number) => Promise<void>, attempts = 3): Promise<any> {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await f(url, { signal: AbortSignal.timeout(60_000) });
      if (r.ok) return await r.json();
      last = `HTTP ${r.status}`;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e: any) { last = e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e); }
    if (i < attempts) await sleep(800 * i);
  }
  throw new Error(last || 'request failed');
}

const searchUrl = (q: string, rows: number, page: number) =>
  `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=mediatype&fl[]=title&rows=${rows}&page=${page}&sort[]=identifier+asc&output=json`;   // fixed sort: unsorted paging overlaps and drops items

/** Every result of a search, following pages. Throws if the Archive reports an error or a page comes back short of numFound. */
export async function searchAll(f: Fetcher, query: string, opts: { rows?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ numFound: number; docs: SearchDoc[] }> {
  const rows = opts.rows ?? 500, sleep = opts.sleep ?? defaultSleep;
  const docs: SearchDoc[] = []; const seen = new Set<string>();
  let numFound = 0;
  for (let page = 1; page <= 40; page++) {
    const j = await getJson(f, searchUrl(query, rows, page), sleep);
    if (j?.error) throw new Error(`archive search error: ${String(j.error).slice(0, 120)}`);
    numFound = Number(j?.response?.numFound ?? 0);
    const got: SearchDoc[] = j?.response?.docs ?? [];
    for (const d of got) if (d?.identifier && !seen.has(d.identifier)) { seen.add(d.identifier); docs.push(d); }
    if (docs.length >= numFound || got.length === 0) break;
  }
  if (docs.length < numFound) throw new Error(`incomplete: got ${docs.length} of ${numFound}`);
  return { numFound, docs };
}

export async function countMembers(f: Fetcher, collectionId: string, sleep = defaultSleep): Promise<number> {
  const j = await getJson(f, searchUrl(`collection:"${collectionId}"`, 0, 1), sleep);
  if (j?.error) throw new Error(`archive search error: ${String(j.error).slice(0, 120)}`);
  return Number(j?.response?.numFound ?? 0);
}

/** Keep only what the catalog reads, so a cache of thousands of items stays small. */
export function reduceMetadata(meta: any) {
  const m = meta?.metadata ?? {};
  const keep = ['identifier', 'title', 'description', 'subject', 'keywords', 'tags', 'collection', 'creator', 'date', 'year', 'mediatype', 'runtime', 'access-restricted-item'];
  const metadata: Record<string, unknown> = {}; for (const k of keep) if (m[k] !== undefined) metadata[k] = m[k];
  const files = (Array.isArray(meta?.files) ? meta.files : []).filter((f: any) => typeof f?.name === 'string')
    .map((f: any) => ({ name: f.name, format: f.format, size: f.size, md5: f.md5, length: f.length, private: f.private }));
  return { is_dark: !!meta?.is_dark, metadata, files };
}

export async function fetchItemMetadata(f: Fetcher, id: string, sleep = defaultSleep): Promise<{ ok: true; meta: ReturnType<typeof reduceMetadata> } | { ok: false; reason: string }> {
  try {
    const j = await getJson(f, `https://archive.org/metadata/${encodeURIComponent(id)}`, sleep);
    if (!j || !j.metadata) return { ok: false, reason: 'not found or empty metadata' };
    return { ok: true, meta: reduceMetadata(j) };
  } catch (e: any) { return { ok: false, reason: String(e?.message ?? e).slice(0, 160) }; }
}
