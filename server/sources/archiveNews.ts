// Layer 3 — Archive News (TV News collections: CNN, Fox, MSNBC, BBC, NTD).
// Structured JSON only: advancedsearch.php?output=json and /metadata/{id}. No HTML.
// Restricted recordings are the normal case for TV News and are reported as
// 'restricted', never as errors. Air time comes from Archive's own identifier
// layout (NETWORK_YYYYMMDD_HHMMSS_Show), which is UTC.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../src/utils/epgIdentity';
import { buildArchiveProxyUrl } from '../../src/utils/archivePlayback';
import type { RejectedItem, SourceContract, SourceResult } from './contract';

export interface ArchiveNewsInput {
  /** Archive network code, e.g. CNNW, FOXNEWSW, MSNBCW, BBCNEWS, NTD. */
  network: string;
  channelId: string;
  channelName: string;
  guideId: string;
  /** Aired within this many days before ctx.now. Archive publishes with a delay. */
  windowDays?: number;
  rows?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ArchiveFile {
  name: string;
  source?: string;
  format?: string;
  length?: string;
  private?: string | boolean;
}

interface ArchiveMetadata {
  is_dark?: boolean;
  metadata?: Record<string, unknown>;
  files?: ArchiveFile[];
}

const USER_AGENT = 'AJN-Precision-Engineering/ArchiveNews';
const METADATA_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
const TV_ID = /^([A-Z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/;

export function parseAirTime(identifier: string): { airedUtc: Date; show: string } | null {
  const m = identifier.match(TV_ID);
  if (!m) return null;
  const airedUtc = new Date(Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]));
  return Number.isFinite(airedUtc.getTime()) ? { airedUtc, show: m[8].replace(/_/g, ' ') } : null;
}

function isPrivate(file: ArchiveFile): boolean {
  return file.private === true || String(file.private).toLowerCase() === 'true';
}

function isRestrictedItem(meta: ArchiveMetadata): boolean {
  if (meta.is_dark) return true;
  const access = String(meta.metadata?.['access-restricted-item'] ?? '').toLowerCase();
  return access === 'true';
}

/** Browser-playable, public, derivative MP4 first; original MP4 only if no derivative. */
export function pickPlayableFile(files: ArchiveFile[]): { file: ArchiveFile | null; allPrivate: boolean } {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name) && String(f.source ?? '').toLowerCase() !== 'metadata');
  const publicMp4 = mp4.filter((f) => !isPrivate(f));
  const derivative = publicMp4.find((f) => String(f.source ?? '').toLowerCase() === 'derivative');
  return { file: derivative ?? publicMp4[0] ?? null, allPrivate: mp4.length > 0 && publicMp4.length === 0 };
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<{ status: number; body: T | null }> {
  const res = await fetchImpl(url, { signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { status: res.status, body: null };
  }
  return { status: res.status, body: (await res.json()) as T };
}

export const archiveNewsContract: SourceContract<ArchiveNewsInput> = {
  sourceClass: 'archive_news',
  priority: 3,
  async hook(input, ctx): Promise<SourceResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const windowDays = input.windowDays ?? 7;
    const windowStart = new Date(ctx.now.getTime() - windowDays * 86_400_000);
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const base = { sourceClass: 'archive_news' as const, fetchedAt: ctx.now.toISOString() };

    // 1. Find items. Archive stores TV News under both NETWORK and TV-NETWORK.
    const network = input.network.trim().replace(/^TV-/i, '');
    const day = (d: Date) => d.toISOString().slice(0, 10);
    let docs: Array<{ identifier: string; title?: string }> = [];
    const searchErrors: number[] = [];
    for (const collection of [network, `TV-${network}`]) {
      const q = `collection:${collection} AND mediatype:movies AND date:[${day(windowStart)} TO ${day(ctx.now)}]`;
      const url = 'https://archive.org/advancedsearch.php'
        + `?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title`
        + `&rows=${Math.min(Math.max(input.rows ?? 25, 1), 100)}&sort[]=date+desc&output=json`;
      const { status, body } = await getJson<{ response?: { docs?: typeof docs } }>(fetchImpl, url, ctx.signal);
      if (status >= 400) searchErrors.push(status);
      docs = body?.response?.docs ?? [];
      if (docs.length > 0) break;
    }
    // One collection failing and the other returning nothing is not "no news": report it.
    if (docs.length === 0 && searchErrors.length > 0) {
      return { ...base, status: 'upstream_error', programs, rejected, error: `advancedsearch HTTP ${searchErrors.join(', ')}` };
    }

    // 2. Window check first (no network), then metadata for the rest in parallel
    //    (bounded), then evaluate in the original order so output is deterministic.
    type Candidate = { id: string; doc: (typeof docs)[number]; aired: NonNullable<ReturnType<typeof parseAirTime>> };
    const candidates: Candidate[] = [];
    for (const doc of docs) {
      const id = doc.identifier;
      const aired = parseAirTime(id);
      if (!aired) { rejected.push({ id, reason: 'identifier has no air time' }); continue; }
      if (aired.airedUtc < windowStart || aired.airedUtc > ctx.now) {
        rejected.push({ id, reason: `aired outside the ${windowDays}-day window` });
        continue;
      }
      candidates.push({ id, doc, aired });
    }
    const metas = await mapWithConcurrency(candidates, METADATA_CONCURRENCY, (c) =>
      getJson<ArchiveMetadata>(fetchImpl, `https://archive.org/metadata/${encodeURIComponent(c.id)}`, ctx.signal)
        .catch((err) => ({ status: 0, body: null as ArchiveMetadata | null, err: String(err?.message ?? err) })),
    );

    let restricted = 0;
    for (let i = 0; i < candidates.length; i++) {
      const { id, doc, aired } = candidates[i];
      const { status, body: meta } = metas[i];
      if (!meta) { rejected.push({ id, reason: `metadata HTTP ${status}` }); continue; }
      if (isRestrictedItem(meta)) { restricted++; rejected.push({ id, reason: 'restricted: access-restricted item' }); continue; }

      const { file, allPrivate } = pickPlayableFile(meta.files ?? []);
      if (!file) {
        if (allPrivate) restricted++;
        rejected.push({ id, reason: allPrivate ? 'restricted: all MP4 files are private' : 'no browser-playable MP4' });
        continue;
      }

      const durationSeconds = Number(file.length) > 0 ? Number(file.length) : undefined;
      const endUtc = new Date(aired.airedUtc.getTime() + (durationSeconds ?? 3600) * 1000);
      const archivePath = `/download/${encodeURIComponent(id)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
      const programId = normalizeProgramIdentity({ externalId: id, channelId: input.channelId, title: aired.show, startTime: aired.airedUtc.toISOString() });
      programs.push({
        id: programId,
        guideId: input.guideId,
        channelId: input.channelId,
        title: String(meta.metadata?.title ?? doc.title ?? aired.show),
        description: `${input.channelName} broadcast: ${aired.show}`,
        startTime: aired.airedUtc.getUTCHours() + aired.airedUtc.getUTCMinutes() / 60,
        endTime: endUtc.getUTCHours() + endUtc.getUTCMinutes() / 60,
        startHour: aired.airedUtc.getUTCHours() + aired.airedUtc.getUTCMinutes() / 60,
        endHour: endUtc.getUTCHours() + endUtc.getUTCMinutes() / 60,
        startTimeUtc: aired.airedUtc.toISOString(),
        endTimeUtc: endUtc.toISOString(),
        mediaType: 'video',
        mediaUrl: buildArchiveProxyUrl(archivePath),
        archivePath,
        assetId: normalizeAssetIdentity({ externalId: `${id}:${file.name}`, archiveIdentifier: id, programId, mediaUrl: archivePath }),
        sourceId: normalizeSourceIdentity({ channelId: input.channelId, url: `archive:${network}`, protocol: 'direct_archive' }),
        sourceClass: 'archive_org',
        isArchivedSource: true,
        metadata: { externalId: id, network, show: aired.show, durationSeconds, durationSource: durationSeconds ? 'metadata' : 'unknown' },
      });
    }

    programs.sort((a, b) => String(a.startTimeUtc).localeCompare(String(b.startTimeUtc)));
    const status: SourceResult['status'] =
      programs.length > 0 ? (rejected.length ? 'partial' : 'ok')
        : restricted > 0 ? 'restricted'
          : rejected.length > 0 ? 'partial' : 'ok';
    return { ...base, status, programs, rejected };
  },
};

/** Networks shown on the Cable TV guide: [Archive network code, channelId, display name]. */
export const NEWS_NETWORKS: Array<[string, string, string]> = [
  ['FOXNEWSW', 'fox-news', 'Fox News'],
  ['CNNW', 'cnn', 'CNN'],
  ['MSNBCW', 'msnbc', 'MSNBC'],
  ['BBCNEWS', 'bbc', 'BBC News'],
  ['NTD', 'ntd', 'NTD News'],
];
