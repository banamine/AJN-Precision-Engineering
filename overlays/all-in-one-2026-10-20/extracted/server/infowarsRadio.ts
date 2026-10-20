import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import type { Program } from '../src/types';
import { archiveApiFetch } from './archiveLimiter';
import { filesFromMetadata, type RushTrack } from './rush';

export const INFOWARS_CHANNEL_ID = 'archive-infowars-radio';
export const INFOWARS_CHANNEL_NAME = 'INFOWARS Archive RADIO';
export const INFOWARS_COLLECTION = 'Radio-The-Alex-Jones-Radio-Show';
export const INFOWARS_WINDOW_SECONDS = 24 * 60 * 60;
export const INFOWARS_MAX_METADATA_PER_DAY = 12;
export const INFOWARS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INFOWARS_CHILD_ID = /^The_Alex_Jones_Radio_Show_\d{8}_\d{6}$/;
const ASR_EXT = /\.asr\.srt$/i;
const AUDIO_EXT = /\.(?:mp3|m4a|aac)$/i;

export interface InfowarsFile {
  name: string;
  private?: string | boolean;
  source?: string;
  format?: string;
  length?: string | number;
  size?: string | number;
}
export interface InfowarsItemMetadata {
  identifier: string;
  private?: string | boolean;
  is_dark?: string | boolean;
  restricted?: string | boolean;
  files: InfowarsFile[];
}
export interface InfowarsDiagnostics {
  candidateCount: number;
  candidateListStatus: 'ok' | 'last_good' | 'unavailable';
  seedIndex: number | null;
  metadataRequests: number;
  resolvedItems: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
  scheduleSeconds: number;
  windowSeconds: number;
  error?: string;
}
export interface InfowarsCandidateSnapshot {
  ids: string[];
  numFound: number;
  pages: number;
  requests: number;
  fetchedAt: string;
  status: 'ok' | 'last_good';
}
export class InfowarsServiceError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'InfowarsServiceError';
  }
}
export interface InfowarsStoreOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheDir?: string | null;
  ttlMs?: number;
}

const isTrue = (v: unknown) => v === true || String(v ?? '').toLowerCase() === 'true';
const safeIdentifier = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9._-]+$/.test(v) && !v.includes('..');
const addReason = (d: InfowarsDiagnostics, reason: string) => {
  d.skippedCount++;
  d.skippedByReason[reason] = (d.skippedByReason[reason] ?? 0) + 1;
};

export function parseInfowarsUtcId(id: string): number | null {
  const m = INFOWARS_CHILD_ID.exec(id);
  if (!m) return null;
  const date = id.slice(-15);
  const year = Number(date.slice(0, 4)); const month = Number(date.slice(4, 6)); const day = Number(date.slice(6, 8));
  const hour = Number(date.slice(9, 11)); const minute = Number(date.slice(11, 13)); const second = Number(date.slice(13, 15));
  const ts = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ts);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day
    && d.getUTCHours() === hour && d.getUTCMinutes() === minute && d.getUTCSeconds() === second ? ts : null;
}

export function sortInfowarsIds(ids: string[]): string[] {
  return [...new Set(ids.filter(safeIdentifier))].sort((a, b) => {
    const ta = parseInfowarsUtcId(a); const tb = parseInfowarsUtcId(b);
    if (ta !== null && tb !== null) return ta - tb || a.localeCompare(b);
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return a.localeCompare(b);
  });
}

/** Same FNV-1a + mulberry32 seeded generator as the existing audio rotation code. */
export function infowarsSeededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const infowarsUtcDaySeed = (date: string) => `infowars:${date}`;
export function infowarsSeedIndex(ids: string[], utcDay: string): number {
  return ids.length ? Math.floor(infowarsSeededRandom(infowarsUtcDaySeed(utcDay))() * ids.length) : 0;
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJsonAtomic(file: string, value: unknown) {
  try {
    fs.mkdirSync(nodePath.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* cache persistence is best-effort; the in-memory good result remains usable */ }
}
function defaultCacheDir(): string | null {
  try {
    if (typeof process === 'undefined') return null;
    return nodePath.join(process.cwd(), '.cache');
  } catch { return null; }
}

export function createInfowarsRadioStore(options: InfowarsStoreOptions = {}) {
  const fetchImpl = options.fetchImpl ?? archiveApiFetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INFOWARS_CACHE_TTL_MS;
  const cacheDir = options.cacheDir === undefined ? defaultCacheDir() : options.cacheDir;
  const candidatesFile = cacheDir ? nodePath.join(cacheDir, 'infowars-candidate-ids.json') : null;
  const itemsFile = cacheDir ? nodePath.join(cacheDir, 'infowars-item-files.json') : null;
  let candidateMemory: InfowarsCandidateSnapshot | null = null;
  let candidatePending: Promise<InfowarsCandidateSnapshot> | null = null;
  let itemMemory: Map<string, { fetchedAt: number; metadata: InfowarsItemMetadata }> | null = null;
  let dayRequestDate = '';
  let dayMetadataRequests = 0;
  let lastDiagnostics: InfowarsDiagnostics = {
    candidateCount: 0, candidateListStatus: 'unavailable', seedIndex: null, metadataRequests: 0,
    resolvedItems: 0, skippedCount: 0, skippedByReason: {}, scheduleSeconds: 0, windowSeconds: INFOWARS_WINDOW_SECONDS,
  };

  function loadItemDisk() {
    if (itemMemory) return itemMemory;
    const raw = itemsFile ? readJson(itemsFile) : null;
    itemMemory = new Map();
    if (raw && typeof raw === 'object') {
      for (const [id, row] of Object.entries<any>(raw)) {
        if (!safeIdentifier(id) || !Array.isArray(row?.metadata?.files) || !Number.isFinite(row?.fetchedAt)) continue;
        itemMemory.set(id, { fetchedAt: Number(row.fetchedAt), metadata: row.metadata as InfowarsItemMetadata });
      }
    }
    return itemMemory;
  }
  function persistItems() {
    if (!itemsFile || !itemMemory) return;
    writeJsonAtomic(itemsFile, Object.fromEntries([...itemMemory.entries()].map(([id, v]) => [id, v])));
  }
  function readCandidateDisk(): InfowarsCandidateSnapshot | null {
    const raw = candidatesFile ? readJson(candidatesFile) : null;
    if (!raw || !Array.isArray(raw.ids) || !raw.ids.length || !Number.isFinite(Date.parse(raw.fetchedAt))) return null;
    const ids = sortInfowarsIds(raw.ids);
    if (!ids.length) return null;
    return { ids, numFound: Number(raw.numFound) || ids.length, pages: Number(raw.pages) || 1, requests: Number(raw.requests) || 0, fetchedAt: String(raw.fetchedAt), status: 'last_good' };
  }
  function persistCandidates(snapshot: InfowarsCandidateSnapshot) {
    if (candidatesFile) writeJsonAtomic(candidatesFile, { ids: snapshot.ids, numFound: snapshot.numFound, pages: snapshot.pages, requests: snapshot.requests, fetchedAt: snapshot.fetchedAt });
  }
  async function fetchCandidateSnapshot(): Promise<InfowarsCandidateSnapshot> {
    const ids: string[] = [];
    let pages = 0;
    let expected = 0;
    const maxPages = 6;
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams();
      params.set('q', `collection:${INFOWARS_COLLECTION}`);
      params.append('fl[]', 'identifier');
      params.append('sort[]', 'identifier asc');
      params.set('rows', '10000');
      params.set('page', String(page));
      params.set('output', 'json');
      const response = await fetchImpl(`https://archive.org/advancedsearch.php?${params}`, {
        headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (audio catalogue probe)' },
      });
      pages++;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new InfowarsServiceError('candidate_search_failed', response.status, `Archive candidate search HTTP ${response.status}`);
      }
      const body = await response.json() as any;
      const responseData = body?.response;
      expected = Number(responseData?.numFound);
      if (!Number.isFinite(expected) || expected < 0 || !Array.isArray(responseData?.docs)) {
        throw new InfowarsServiceError('candidate_search_invalid', 502, 'Archive candidate search returned an invalid identifier response');
      }
      for (const row of responseData.docs) if (safeIdentifier(row?.identifier)) ids.push(row.identifier);
      if (ids.length >= expected) break;
      if (responseData.docs.length === 0) break;
    }
    const sorted = sortInfowarsIds(ids);
    if (expected <= 0 || sorted.length !== expected) {
      throw new InfowarsServiceError('candidate_list_incomplete', 502, `Archive candidate list incomplete (${sorted.length}/${expected})`);
    }
    return { ids: sorted, numFound: expected, pages, requests: pages, fetchedAt: new Date(now()).toISOString(), status: 'ok' };
  }
  async function getCandidateSnapshot(force = false): Promise<InfowarsCandidateSnapshot> {
    const currentTime = now();
    if (!force && candidateMemory && currentTime - Date.parse(candidateMemory.fetchedAt) < ttlMs) return candidateMemory;
    if (!force && !candidateMemory) {
      const disk = readCandidateDisk();
      if (disk && currentTime - Date.parse(disk.fetchedAt) < ttlMs) {
        candidateMemory = disk;
        return disk;
      }
    }
    candidatePending ??= fetchCandidateSnapshot().then((snapshot) => {
      candidateMemory = snapshot;
      persistCandidates(snapshot);
      return snapshot;
    }).catch((error) => {
      const lastGood = candidateMemory ?? readCandidateDisk();
      if (lastGood) {
        candidateMemory = { ...lastGood, status: 'last_good' };
        return candidateMemory;
      }
      throw error;
    }).finally(() => { candidatePending = null; });
    return candidatePending;
  }

  async function getItemMetadata(id: string, force = false): Promise<InfowarsItemMetadata> {
    if (!safeIdentifier(id)) throw new InfowarsServiceError('invalid_identifier', 400, 'Invalid Archive identifier');
    const cache = loadItemDisk();
    const hit = cache.get(id);
    if (!force && hit && now() - hit.fetchedAt < ttlMs) return hit.metadata;
    const utcDay = new Date(now()).toISOString().slice(0, 10);
    if (dayRequestDate !== utcDay) { dayRequestDate = utcDay; dayMetadataRequests = 0; }
    if (dayMetadataRequests >= INFOWARS_MAX_METADATA_PER_DAY) {
      throw new InfowarsServiceError('daily_metadata_cap', 503, 'Daily Archive metadata request cap reached');
    }
    dayMetadataRequests++;
    const response = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (audio catalogue probe)' },
    });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel().catch(() => {});
      throw new InfowarsServiceError('metadata_upstream', response.status, `Archive metadata HTTP ${response.status}${retryAfter ? ' with Retry-After' : ''}`);
    }
    const raw = await response.json() as any;
    const files: InfowarsFile[] = Array.isArray(raw?.files) ? raw.files
      .filter((f: any) => typeof f?.name === 'string')
      .map((f: any) => ({
        name: String(f.name), private: f.private === undefined ? undefined : String(f.private),
        source: typeof f.source === 'string' ? f.source : undefined,
        format: typeof f.format === 'string' ? f.format : undefined,
        length: f.length === undefined ? undefined : String(f.length),
        size: f.size === undefined ? undefined : String(f.size),
      })) : [];
    const metadata: InfowarsItemMetadata = {
      identifier: id, private: raw?.metadata?.private === undefined ? undefined : String(raw.metadata.private),
      is_dark: raw?.metadata?.is_dark === undefined ? undefined : String(raw.metadata.is_dark),
      restricted: raw?.metadata?.restricted === undefined ? undefined : String(raw.metadata.restricted),
      files,
    };
    cache.set(id, { fetchedAt: now(), metadata });
    persistItems();
    return metadata;
  }
  function cachedItemMetadata(id: string): InfowarsItemMetadata | null {
    const entry = loadItemDisk().get(id);
    return entry && now() - entry.fetchedAt < ttlMs ? entry.metadata : null;
  }
  function itemRequestCountForDay(): number { return dayMetadataRequests; }
  function record(diagnostics: InfowarsDiagnostics) { lastDiagnostics = { ...diagnostics, skippedByReason: { ...diagnostics.skippedByReason } }; }

  async function buildChannel(guideId: string, nowDate = new Date()): Promise<Program[]> {
    const diagnostics: InfowarsDiagnostics = {
      candidateCount: 0, candidateListStatus: 'unavailable', seedIndex: null, metadataRequests: 0,
      resolvedItems: 0, skippedCount: 0, skippedByReason: {}, scheduleSeconds: 0, windowSeconds: INFOWARS_WINDOW_SECONDS,
    };
    try {
      const candidateSnapshot = await getCandidateSnapshot();
      const ids = sortInfowarsIds(candidateSnapshot.ids);
      diagnostics.candidateCount = ids.length;
      diagnostics.candidateListStatus = candidateSnapshot.status;
      if (!ids.length) throw new InfowarsServiceError('candidate_list_empty', 503, 'No eligible collection identifiers are available');
      const day = nowDate.toISOString().slice(0, 10);
      const startIndex = infowarsSeedIndex(ids, day);
      diagnostics.seedIndex = startIndex;
      const programs: Program[] = [];
      const used = new Set<string>();
      let consecutiveServerErrors = 0;
      for (let offset = 0; offset < ids.length && diagnostics.scheduleSeconds < diagnostics.windowSeconds && diagnostics.metadataRequests < INFOWARS_MAX_METADATA_PER_DAY; offset++) {
        const id = ids[(startIndex + offset) % ids.length];
        if (used.has(id)) continue;
        used.add(id);
        let metadata: InfowarsItemMetadata;
        const cached = cachedItemMetadata(id);
        if (cached) metadata = cached;
        else {
          const before = itemRequestCountForDay();
          try { metadata = await getItemMetadata(id); }
          catch (error) {
            diagnostics.metadataRequests += Math.max(0, itemRequestCountForDay() - before);
            const e = error as InfowarsServiceError;
            if (e.status === 403 || e.status === 429 || /Retry-After/i.test(e.message)) {
              diagnostics.error = e.message; record(diagnostics); throw error;
            }
            if (e.status >= 500) {
              consecutiveServerErrors++;
              addReason(diagnostics, 'metadata_upstream_error');
              if (consecutiveServerErrors >= 2) { diagnostics.error = e.message; record(diagnostics); throw error; }
            } else {
              consecutiveServerErrors = 0;
              addReason(diagnostics, e.code || 'metadata_error');
            }
            continue;
          }
          diagnostics.metadataRequests += Math.max(0, itemRequestCountForDay() - before);
        }
        consecutiveServerErrors = 0;
        if (isTrue(metadata.private) || isTrue(metadata.is_dark) || isTrue(metadata.restricted)) {
          addReason(diagnostics, isTrue(metadata.private) ? 'item_private' : isTrue(metadata.is_dark) ? 'item_dark' : 'item_restricted');
          continue;
        }
        const playable = filesFromMetadata(metadata);
        if (!playable.length) {
          const publicAudio = metadata.files.filter((f) => AUDIO_EXT.test(f.name) && !isTrue(f.private));
          const privateAudio = metadata.files.filter((f) => AUDIO_EXT.test(f.name) && isTrue(f.private));
          addReason(diagnostics, !publicAudio.length && privateAudio.length ? 'audio_private_only' : publicAudio.length ? 'audio_length_zero_or_missing' : 'no_admissible_audio');
          continue;
        }
        const chosen = playable[0];
        if (!(chosen.durationSeconds > 0)) { addReason(diagnostics, 'audio_length_zero_or_missing'); continue; }
        const archivePath = `/download/${encodeURIComponent(id)}/${chosen.file.split('/').map(encodeURIComponent).join('/')}`;
        const date = parseInfowarsUtcId(id);
        const title = date === null ? `Archive recording — ${id}` : `Archive recording — ${new Date(date).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}`;
        const track: RushTrack = {
          ...chosen, archivePath, mediaUrl: `/api/archive/proxy?path=${encodeURIComponent(archivePath)}`,
        };
        programs.push({
          id, guideId, channelId: INFOWARS_CHANNEL_ID, sourceId: id, title,
          startTime: 0, endTime: 0, mediaType: 'audio', mediaUrl: track.mediaUrl, archivePath,
          sourceClass: 'archive_org', isArchivedSource: true,
          metadata: { durationSeconds: chosen.durationSeconds, durationSource: 'metadata', file: chosen.file, format: chosen.format, size: chosen.size },
        } as Program);
        diagnostics.resolvedItems++;
        diagnostics.scheduleSeconds += chosen.durationSeconds;
      }
      if (!programs.length) {
        diagnostics.error ??= 'No public audio items with a known positive duration were resolved';
        record(diagnostics);
        return [];
      }
      if (diagnostics.scheduleSeconds < diagnostics.windowSeconds) diagnostics.error ??= 'Resolved audio is shorter than the 24-hour schedule window';
      record(diagnostics);
      return programs;
    } catch (error) {
      diagnostics.error ??= error instanceof Error ? error.message : 'Archive collection unavailable';
      record(diagnostics);
      throw error;
    }
  }

  return {
    getCandidateSnapshot, getItemMetadata, cachedItemMetadata, buildChannel, getDiagnostics: () => ({ ...lastDiagnostics, skippedByReason: { ...lastDiagnostics.skippedByReason } }),
    candidatePaths: () => ({ candidatesFile, itemsFile }),
  };
}

const defaultStore = createInfowarsRadioStore();
export const getInfowarsCandidateSnapshot = () => defaultStore.getCandidateSnapshot();
export const getInfowarsItemMetadata = (id: string) => defaultStore.getItemMetadata(id);
export const getCachedInfowarsItemMetadata = (id: string) => defaultStore.cachedItemMetadata(id);
export const buildInfowarsRadioChannel = (guideId: string, now = new Date()) => defaultStore.buildChannel(guideId, now);
export const getInfowarsDiagnostics = () => defaultStore.getDiagnostics();
