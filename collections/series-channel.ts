/* Channels built from src/data/seriesManifests.json (scripts/series-manifest.ts). One channel per series, every episode of
 * every season in season/episode order. No Archive call at runtime; the proxy checks each file when it is played, and a
 * failure surfaces as a normal playback error (no silent fallback). */
import type { Program } from '../src/types';
import { normalizeProgramIdentity, normalizeAssetIdentity, normalizeSourceIdentity } from '../src/utils/epgIdentity';
import { SERIES_CONFIG, type SeriesConfig } from './series-config';
import type { Manifest } from './series-parse';
import manifestFile from '../src/data/seriesManifests.json';

const manifests = (manifestFile as unknown as { series: Record<string, Manifest> }).series ?? {};

export const seriesChannels = (): SeriesConfig[] => SERIES_CONFIG.filter((c) => (manifests[c.key]?.episodes.length ?? 0) > 0);
export const getSeriesManifest = (key: string): Manifest | undefined => manifests[key];

const pad = (n: number) => String(n).padStart(2, '0');

/** Base programs (not yet laid out in time), in season/episode order. */
export function seriesBasePrograms(cfg: SeriesConfig): Program[] {
  const m = manifests[cfg.key];
  if (!m) return [];
  return m.episodes.map((e) => {
    const title = `${cfg.series} S${pad(e.season)}E${pad(e.episode)} ${e.title}`.trim();
    const externalId = `${e.identifier}|S${e.season}E${e.episode}`;
    return {
      id: normalizeProgramIdentity({ externalId, channelId: cfg.channelId, title, startTime: 0 }),
      guideId: 'classic-tv', channelId: cfg.channelId, title,
      description: `${cfg.group} · ${cfg.series} · Season ${e.season}, episode ${e.episode}. Archive.org item ${e.identifier}.`,
      startTime: 0, endTime: 0, mediaType: 'video',
      mediaUrl: e.path, archivePath: e.path,
      assetId: normalizeAssetIdentity({ externalId, mediaUrl: e.path }),
      sourceId: normalizeSourceIdentity({ channelId: cfg.channelId, url: e.path, protocol: 'direct_archive' }),
      sourceClass: 'archive_org', isArchivedSource: true,
      metadata: { externalId, archiveIdentifier: e.identifier, durationSeconds: e.durationSeconds, genre: cfg.group, series: cfg.series, season: e.season, episode: e.episode, episodeTitle: e.title, collectionId: cfg.key, ...(e.thumb ? { thumbFile: e.thumb } : {}) },
    } as Program;
  });
}
