/* Shared helpers for the catalog bake (Phase 1). No runtime server code imports this. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_MANIFEST = 'ajn.baked.v1';
export const SCHEMA_CATALOG = 'ajn.catalog.v1';
export const BAKED_DIR = 'src/data/baked';

export type FailClass = 'missing' | 'transient' | 'invalid' | 'excluded';
export interface Unresolved { id: string; class: FailClass; reason: string }
export interface CatalogItem { id: string; title: string; kind: 'audio' | 'video'; path: string; durationSeconds?: number; size?: number; format?: string; show?: string; season?: number; episode?: number }
export interface CatalogChannel { id: string; name: string; group: string; itemIds: string[]; stale?: boolean }
export interface Catalog { schema: typeof SCHEMA_CATALOG; genre: string; items: Record<string, CatalogItem>; channels: CatalogChannel[]; unresolved: Unresolved[] }
export interface ManifestFile { sha256: string; bytes: number; items: number; channels: number }
export interface Manifest { schema: typeof SCHEMA_MANIFEST; version: string; generatedAt: string; dir: string; files: Record<string, ManifestFile> }

export const sha256 = (buf: Buffer | string) => crypto.createHash('sha256').update(buf).digest('hex');
export const readJson = <T>(p: string): T | null => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; } };

/** HTTP status / thrown error -> failure class. 404/410/dark = missing; 5xx/429/network = transient; else invalid. */
export function classify(status: number | null, err?: unknown): FailClass {
  if (status === null) return 'transient';
  if (status === 404 || status === 410 || status === 403) return 'missing';
  if (status === 429 || status >= 500) return 'transient';
  return 'invalid';
}

/** fetch with bounded retries + backoff; returns the Response (any status) or throws after the last network error. */
export async function fetchRetry(url: string, f: typeof fetch, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await f(url, { headers: { 'User-Agent': 'AJN-Precision-Engineering/Bake' } });
      if (r.status !== 429 && r.status < 500) return r;
      last = new Error(`HTTP ${r.status}`); await r.body?.cancel().catch(() => {});
      if (i === tries - 1) return r;
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 600 * 2 ** i));
  }
  throw last;
}

/** Sorted-key stable stringify so identical content always hashes identically. */
export function stable(v: unknown): string {
  const norm = (x: any): any => Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x;
  return JSON.stringify(norm(v));
}

export function writeCatalog(dir: string, file: string, cat: Catalog): ManifestFile {
  const text = stable(cat);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  return { sha256: sha256(text), bytes: Buffer.byteLength(text), items: Object.keys(cat.items).length, channels: cat.channels.length };
}

export function loadPrevious(root: string, file: string): Catalog | null {
  const m = readJson<Manifest>(path.join(root, BAKED_DIR, 'manifest.json'));
  return m ? readJson<Catalog>(path.join(root, BAKED_DIR, m.dir, file)) : null;
}
