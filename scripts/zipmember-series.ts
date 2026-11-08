import fs from 'node:fs';
import path from 'node:path';

export interface FastCopyEntry {
  source: string;
  url: string;
  durationSec: number;
  bytes?: number;
  seriesKey?: string;
  season?: number;
  episode?: number;
  title?: string;
}

export interface AdmittedEpisode {
  season: number;
  episode: number;
  title: string;
  identifier: string;
  fileName: string;
  path: string;
  format: string;
  sizeBytes: number;
  durationSeconds: number;
  durationEstimated: boolean;
  thumb?: string;
}

export interface SeriesManifest {
  title?: string;
  episodes: AdmittedEpisode[];
  seasons: Array<{
    season: number;
    episodes: number;
    first: number;
    last: number;
    missing: number[];
  }>;
  issues: string[];
}

export const ZIPMEMBER_KEYS = [
  'sc-babylon-5',
  'sc-agents-of-shield',
  'sc-star-trek-ds9',
  'sc-stargate-atlantis',
] as const;

export type ZipMemberKey = (typeof ZIPMEMBER_KEYS)[number];

const ARCHIVE_ZIP_MEMBER = /\.(zip|7z|rar|tar|tgz|gz|bz2|xz)\/[^?]/i;

export function identifySeriesKey(str: string): ZipMemberKey | null {
  const s = str.toLowerCase();
  if (s.includes('babylon-5') || s.includes('babylon 5')) return 'sc-babylon-5';
  if (s.includes('agents-of-shield') || s.includes('agents of shield') || s.includes('shield')) return 'sc-agents-of-shield';
  if (s.includes('ds9') || s.includes('deep space nine') || s.includes('deep-space-nine') || (s.includes('star trek') && s.includes('ds9'))) return 'sc-star-trek-ds9';
  if (s.includes('stargate-atlantis') || s.includes('stargate atlantis') || s.includes('atlantis')) return 'sc-stargate-atlantis';
  return null;
}

export function parseEpisodeDetails(entry: FastCopyEntry): {
  season: number;
  episode: number;
  title: string;
  fileName: string;
  identifier: string;
} | null {
  const text = decodeURIComponent(`${entry.source} ${entry.url} ${entry.title ?? ''}`);
  const match = text.match(/s(\d{1,2})[\s._-]*e(\d{1,2}(?:-\d{1,2})?)/i);
  
  const season = entry.season ?? (match ? parseInt(match[1], 10) : 1);
  let episode = entry.episode ?? 1;
  let episodeTag = '';
  if (match) {
    episodeTag = match[2];
    const firstEp = parseInt(episodeTag.split('-')[0], 10);
    if (!isNaN(firstEp)) episode = entry.episode ?? firstEp;
  }

  // Derive fileName
  let fileName = entry.url.split('/').pop()?.split('?')[0] || `S${season}E${episode}.mp4`;
  fileName = decodeURIComponent(fileName);

  // Extract clean episode title
  let title = entry.title;
  if (!title) {
    const rawName = fileName.replace(/\.[a-z0-9]+$/i, '');
    const seIdx = rawName.search(/s\d{1,2}[\s._-]*e\d{1,2}(?:-\d{1,2})?/i);
    if (seIdx !== -1) {
      const after = rawName.slice(seIdx).replace(/^s\d{1,2}[\s._-]*e\d{1,2}(?:-\d{1,2})?[\s._-]*/i, '').trim();
      title = after || rawName;
    } else {
      title = rawName;
    }
    // Clean up trailing tags like -eng-cc1-captions
    title = title.replace(/[-_]eng[-_]cc1.*$/i, '').trim();
  }

  // Derive identifier from url or source
  let identifier = 'archive-item';
  const idMatch = (entry.url || entry.source).match(/\/download\/([^/]+)/);
  if (idMatch) {
    identifier = idMatch[1];
  }

  return { season, episode, title, fileName, identifier };
}

export function validateFastCopyEntry(entry: FastCopyEntry): { valid: boolean; reason?: string } {
  if (!entry.url || typeof entry.url !== 'string') {
    return { valid: false, reason: 'Missing url' };
  }
  if (ARCHIVE_ZIP_MEMBER.test(entry.url)) {
    return { valid: false, reason: 'Refused: url is a zip-member (Range not supported, unplayable)' };
  }
  if (!/\.(mp4|m4v|webm)$/i.test(entry.url.split('?')[0])) {
    return { valid: false, reason: 'Refused: url is not a direct MP4/playable format' };
  }
  if (typeof entry.durationSec !== 'number' || !Number.isFinite(entry.durationSec) || entry.durationSec <= 0) {
    return { valid: false, reason: 'Refused: durationSec must be a real finite positive number' };
  }
  return { valid: true };
}

export function buildZipmemberSeriesManifests(
  fastCopies: FastCopyEntry[],
  existingManifests: Record<string, any>
): {
  updatedManifests: Record<string, any>;
  report: Record<ZipMemberKey, { episodes: number; rejected: number; issues: string[] }>;
} {
  const updatedManifests = { ...existingManifests };
  const report: Record<ZipMemberKey, { episodes: number; rejected: number; issues: string[] }> = {
    'sc-babylon-5': { episodes: 0, rejected: 0, issues: [] },
    'sc-agents-of-shield': { episodes: 0, rejected: 0, issues: [] },
    'sc-star-trek-ds9': { episodes: 0, rejected: 0, issues: [] },
    'sc-stargate-atlantis': { episodes: 0, rejected: 0, issues: [] },
  };

  const showMap: Record<ZipMemberKey, AdmittedEpisode[]> = {
    'sc-babylon-5': [],
    'sc-agents-of-shield': [],
    'sc-star-trek-ds9': [],
    'sc-stargate-atlantis': [],
  };

  for (const entry of fastCopies) {
    const key = (entry.seriesKey as ZipMemberKey) || identifySeriesKey(entry.source) || identifySeriesKey(entry.url);
    if (!key || !(key in showMap)) {
      continue;
    }

    const validation = validateFastCopyEntry(entry);
    if (!validation.valid) {
      report[key].rejected += 1;
      report[key].issues.push(`Entry for ${entry.source || entry.url}: ${validation.reason}`);
      continue;
    }

    const details = parseEpisodeDetails(entry);
    if (!details) {
      report[key].rejected += 1;
      report[key].issues.push(`Could not parse episode details for ${entry.source || entry.url}`);
      continue;
    }

    showMap[key].push({
      season: details.season,
      episode: details.episode,
      title: details.title,
      identifier: details.identifier,
      fileName: details.fileName,
      path: entry.url,
      format: 'h.264',
      sizeBytes: entry.bytes ?? 0,
      durationSeconds: Math.round(entry.durationSec),
      durationEstimated: false,
    });
  }

  for (const key of ZIPMEMBER_KEYS) {
    const episodes = showMap[key];
    // Sort seasons in order, episodes in order
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);

    const seasonsMap = new Map<number, AdmittedEpisode[]>();
    for (const ep of episodes) {
      if (!seasonsMap.has(ep.season)) seasonsMap.set(ep.season, []);
      seasonsMap.get(ep.season)!.push(ep);
    }

    const seasonsSummary = Array.from(seasonsMap.entries()).map(([season, eps]) => ({
      season,
      episodes: eps.length,
      first: eps[0]?.episode ?? 1,
      last: eps[eps.length - 1]?.episode ?? eps.length,
      missing: [] as number[],
    }));

    report[key].episodes = episodes.length;

    updatedManifests[key] = {
      title: key === 'sc-babylon-5' ? 'Babylon 5'
        : key === 'sc-agents-of-shield' ? "Marvel's Agents of S.H.I.E.L.D."
        : key === 'sc-star-trek-ds9' ? 'Star Trek: Deep Space Nine'
        : 'Stargate Atlantis',
      episodes,
      seasons: seasonsSummary,
      issues: report[key].issues,
    };
  }

  return { updatedManifests, report };
}

export function mergeZipmemberFastcopies(options?: {
  fastcopiesPath?: string;
  manifestsPath?: string;
}): void {
  const fastcopiesPath = options?.fastcopiesPath || path.resolve('data/zipmember-fastcopies.json');
  const manifestsPath = options?.manifestsPath || path.resolve('src/data/seriesManifests.json');

  let fastCopies: FastCopyEntry[] = [];
  if (fs.existsSync(fastcopiesPath)) {
    try {
      fastCopies = JSON.parse(fs.readFileSync(fastcopiesPath, 'utf8'));
    } catch (e) {
      console.error(`[zipmember-series] Failed to read ${fastcopiesPath}:`, e);
      fastCopies = [];
    }
  }

  let manifestData: { schemaVersion: number; generatedAt: string; series: Record<string, any> } = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    series: {},
  };

  if (fs.existsSync(manifestsPath)) {
    manifestData = JSON.parse(fs.readFileSync(manifestsPath, 'utf8'));
  }

  const { updatedManifests, report } = buildZipmemberSeriesManifests(fastCopies, manifestData.series);
  manifestData.series = updatedManifests;
  manifestData.generatedAt = new Date().toISOString();

  const tmpPath = `${manifestsPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifestData, null, 1) + '\n', 'utf8');
  fs.renameSync(tmpPath, manifestsPath);

  console.log('[zipmember-series] Merge complete. Summary:');
  for (const [key, info] of Object.entries(report)) {
    console.log(`  ${key}: ${info.episodes} episode(s), ${info.rejected} rejected`);
    for (const issue of info.issues) {
      console.log(`    issue: ${issue}`);
    }
  }
}

// When run directly from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  mergeZipmemberFastcopies();
}
