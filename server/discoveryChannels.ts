/* "Create 24/7 Channel" from Search: a channel built from the exact Archive
 * items the viewer is looking at. TV News recordings are private as whole
 * files (the full .mp4 answers 401) but Archive serves exact clip windows of
 * them, so each recording becomes a run of clips — the same links the news
 * guide and the "Watch Broadcast" buttons use. Other items get their playable
 * file from the shared selector. Channels live in memory under guide
 * 'discovery', so the player's auto-advance can walk them 24/7.
 * No Node APIs at import time. */
import type { Program } from '../src/types';
import { archiveApiFetch } from './archiveLimiter';
import { clipWindows } from './sources/archiveNews';
import { selectPlayableFile } from './archive/mediaSelector';

export const DISCOVERY_GUIDE_ID = 'discovery';
export const MAX_DISCOVERY_ITEMS = 25;
export interface DiscoveryChannel { id: string; name: string; network?: string; builtAt: string; programs: Program[]; skipped: Array<{ identifier: string; reason: string }> }

const channels = new Map<string, DiscoveryChannel>();
const MAX_CHANNELS = 20;
export function getDiscoveryChannels(): DiscoveryChannel[] { return [...channels.values()]; }
export function resetDiscoveryForTests() { channels.clear(); }

let metaFetch: typeof fetch = archiveApiFetch;
export function setDiscoveryFetchForTests(f?: typeof fetch) { metaFetch = f ?? archiveApiFetch; }

const TV_NEWS_ID = /^[A-Z0-9]+W?_\d{8}_\d{6}_/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'channel';

async function metadata(id: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await metaFetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch { /* retry once */ }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return null;
}

/** Programs for one Archive item (clips for TV News, one file otherwise). */
export function programsForItem(id: string, meta: any, channelId: string, fallbackTitle?: string): { programs: Program[]; reason?: string } {
  if (!meta || !Array.isArray(meta.files)) return { programs: [], reason: 'no metadata' };
  if (meta.is_dark) return { programs: [], reason: 'item withdrawn' };
  const title = String(meta.metadata?.title ?? fallbackTitle ?? id);
  const collections = [].concat(meta.metadata?.collection ?? []).map(String);
  const isTvNews = TV_NEWS_ID.test(id) || collections.includes('tvarchive') || collections.includes('tvnews');
  const base = { guideId: DISCOVERY_GUIDE_ID, channelId, mediaType: 'video' as const, sourceClass: 'archive_org' as const, isArchivedSource: true, startTime: 0, endTime: 0 };
  if (isTvNews) {
    const mp4 = meta.files.find((f: any) => f.name === `${id}.mp4`) ?? meta.files.find((f: any) => /\.mp4$/i.test(f.name));
    if (!mp4) return { programs: [], reason: 'recording not published yet (no MP4)' };
    const secs = Number(mp4.length) > 0 ? Number(mp4.length) : 3600;
    const windows = clipWindows(secs);
    return { programs: windows.map(([start, end], n) => {
      const archivePath = `/download/${encodeURIComponent(id)}/${encodeURIComponent(mp4.name)}?exact=1&start=${start}&end=${end}`;
      return { ...base, id: `disc-${id}-c${n}`, title: windows.length > 1 ? `${title} (part ${n + 1} of ${windows.length})` : title,
        description: title, mediaUrl: archivePath, archivePath, metadata: { identifier: id, durationSeconds: end - start, clip: true } } as Program;
    }) };
  }
  const m = selectPlayableFile(id, meta.files, meta.metadata?.runtime, String(meta.metadata?.mediatype) === 'audio' ? 'audio' : 'video');
  if (m.availability === 'unsupported') return { programs: [], reason: m.selectedBecause };
  return { programs: [{ ...base, mediaType: m.mediaType, id: `disc-${id}`, title, description: title, mediaUrl: m.canonicalPath, archivePath: m.canonicalPath,
    metadata: { identifier: id, durationSeconds: m.durationSeconds, durationSource: m.durationSource, format: m.format } } as Program] };
}

/** Build (or rebuild) a channel from these identifiers, in the order given. */
export async function buildDiscoveryChannel(identifiers: string[], name: string, network?: string, titles: Record<string, string> = {}): Promise<DiscoveryChannel> {
  const ids = [...new Set(identifiers.filter((x) => typeof x === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(x)))].slice(0, MAX_DISCOVERY_ITEMS);
  if (!ids.length) throw Object.assign(new Error('no valid Archive identifiers'), { status: 400 });
  const id = `discovery-${slug(network ? `${network}-${name}` : name)}`;
  const results: Array<{ programs: Program[]; reason?: string }> = new Array(ids.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (next < ids.length) { const k = next++; results[k] = programsForItem(ids[k], await metadata(ids[k]), id, titles[ids[k]]); }
  }));
  const programs = results.flatMap((r) => r.programs);
  const skipped = results.map((r, k) => ({ identifier: ids[k], reason: r.reason })).filter((x): x is { identifier: string; reason: string } => !!x.reason);
  if (!programs.length) throw Object.assign(new Error(`none of the ${ids.length} items has a playable file (${skipped[0]?.reason ?? 'unknown'})`), { status: 422 });
  const ch: DiscoveryChannel = { id, name, network, builtAt: new Date().toISOString(), programs, skipped };
  channels.delete(id); channels.set(id, ch);
  while (channels.size > MAX_CHANNELS) channels.delete(channels.keys().next().value!);
  return ch;
}
