/** Historical homepage captures for the audio player's "Library capture" preview and viewer.
 *  The catalog lists only captures that pass a screening filter; images are served through this app, never as outbound links.
 *  The upstream address stays on the server: the browser only ever sees an opaque capture id like 20250610T065900-0500. */
import type { Express, Request, Response } from 'express';
import { archiveApiFetch } from './archiveLimiter';

export const HOMEPAGE_ITEMS = ['infowars-2022', 'infowars-2023', 'infowars-2024', 'infowars-2025', 'infowars-2026'] as const;
/** Screening rule only (blank/challenge pages are tiny): main capture image must be at least this many bytes. Not a quality judgement. */
export const MIN_CAPTURE_BYTES = 100_000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // stays far below Cloud Run's 32 MiB response cap
export const CATALOG_TTL_MS = 60 * 60 * 1000;
export const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ID_RE = /^\d{8}T\d{6}[+-]\d{4}$/;

export interface UpstreamFile { name?: string; size?: string | number; private?: string | boolean }
export interface Capture { id: string; item: string; file: string; bytes: number }

const NAME_RE = /^infowars-(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-])(\d{2}):(\d{2})\.jpg$/;

/** Main capture images only (not _thumb, .fullpage, side files). Returns the opaque id built from the capture time + its numeric UTC offset. */
export function parseCaptureName(name: string): string | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}${m[7]}${m[8]}${m[9]}`;
}

/** Eligible = main .jpg, not restricted, at least MIN_CAPTURE_BYTES; one entry per capture time (first listed wins). Sorted by capture time. */
export function buildCaptures(item: string, files: UpstreamFile[]): Capture[] {
  const seen = new Map<string, Capture>();
  for (const f of files) {
    const name = String(f.name ?? '');
    const id = parseCaptureName(name);
    if (!id || seen.has(id)) continue;
    if (f.private === true || String(f.private).toLowerCase() === 'true') continue;
    const bytes = Number(f.size);
    if (!Number.isFinite(bytes) || bytes < MIN_CAPTURE_BYTES) continue;
    seen.set(id, { id, item, file: name, bytes });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

interface ItemCache { at: number; captures: Capture[] }
const cache = new Map<string, ItemCache>();
const inflight = new Map<string, Promise<void>>();

async function refreshItem(item: string): Promise<void> {
  const r = await archiveApiFetch(`https://archive.org/metadata/${item}`, { headers: { 'User-Agent': 'AJN-Precision-Engineering/LibraryReel', Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`metadata HTTP ${r.status}`);
  if (!/json/i.test(r.headers.get('content-type') ?? '')) throw new Error('metadata was not JSON');
  const meta = await r.json() as { files?: UpstreamFile[]; is_dark?: boolean };
  if (meta.is_dark) throw new Error('item unavailable');
  cache.set(item, { at: Date.now(), captures: buildCaptures(item, meta.files ?? []) });
}

function refreshOnce(item: string): Promise<void> {
  let p = inflight.get(item);
  if (!p) { p = refreshItem(item).finally(() => inflight.delete(item)); inflight.set(item, p); }
  return p;
}

export type CatalogStatus = 'ok' | 'stale' | 'empty' | 'unavailable';
export interface CatalogResult { status: CatalogStatus; captures: Capture[] }

/** Fresh items are reused; failed refreshes keep the last good copy (up to STALE_MAX_AGE_MS) and report 'stale'.
 *  'unavailable' = upstream failed and nothing usable is held; 'empty' = upstream answered but nothing passed the filter. */
export async function getCatalog(now = Date.now()): Promise<CatalogResult> {
  let failed = false;
  await Promise.all(HOMEPAGE_ITEMS.map(async (item) => {
    const hit = cache.get(item);
    if (hit && now - hit.at < CATALOG_TTL_MS) return;
    try { await refreshOnce(item); } catch { failed = true; }
  }));
  const captures: Capture[] = [];
  let stale = false;
  for (const item of HOMEPAGE_ITEMS) {
    const hit = cache.get(item);
    if (!hit) continue;
    if (now - hit.at >= STALE_MAX_AGE_MS) { cache.delete(item); continue; }
    if (now - hit.at >= CATALOG_TTL_MS) stale = true;
    captures.push(...hit.captures);
  }
  captures.sort((a, b) => a.id.localeCompare(b.id));
  if (captures.length === 0) return { status: failed ? 'unavailable' : 'empty', captures };
  return { status: stale || failed ? 'stale' : 'ok', captures };
}

export function resetHomepageLibraryForTests(): void { cache.clear(); inflight.clear(); }

async function sendCatalog(_req: Request, res: Response): Promise<void> {
  const { status, captures } = await getCatalog();
  if (status === 'unavailable') { res.set('Cache-Control', 'no-store').status(502).json({ status, ids: [] }); return; }
  res.set('Cache-Control', status === 'ok' ? 'public, max-age=600' : 'no-store').json({ status, count: captures.length, ids: captures.map((c) => c.id) });
}

async function sendImage(req: Request, res: Response): Promise<void> {
  const id = String(req.query.id ?? '');
  if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad capture id' }); return; }
  const { captures } = await getCatalog();
  const cap = captures.find((c) => c.id === id);
  if (!cap) { res.status(404).json({ error: 'capture not in library' }); return; }
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    const r = await archiveApiFetch(`https://archive.org/download/${cap.item}/${encodeURIComponent(cap.file)}`, { headers: { 'User-Agent': 'AJN-Precision-Engineering/LibraryReel' }, signal: AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]) });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !/^image\/jpeg/i.test(type)) { res.set('Cache-Control', 'no-store').status(502).json({ error: `library image unavailable (${r.status})` }); return; }
    const declared = Number(r.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) { res.status(502).json({ error: 'library image too large' }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES || buf.length < 1000) { res.status(502).json({ error: 'library image invalid' }); return; }
    res.set({ 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'public, max-age=86400' }).end(buf);
  } catch {
    if (!res.headersSent) res.set('Cache-Control', 'no-store').status(502).json({ error: 'library image unavailable' });
  }
}

export function registerHomepageLibraryRoutes(app: Express): void {
  app.get('/api/library/homepages', (req, res) => { void sendCatalog(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ status: 'unavailable', ids: [] }); }); });
  app.get('/api/library/homepage-image', (req, res) => { void sendImage(req, res); });
}
