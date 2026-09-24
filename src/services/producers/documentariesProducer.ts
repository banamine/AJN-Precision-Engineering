// Documentaries from the user's curated library export (documentaries.json).
// One channel per groupTitle; URLs used exactly as exported.
import manifest from '../../data/documentariesManifest.json';
import type { Program } from '../../types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';
import { playableUrl, slug } from '../../../server/sources/archiveLinks';

interface Entry { g: string; id: string; t: string; s: number | null; e: number | null; d: number | null; u: string }
export interface DocumentaryChannel { id: string; name: string; logo?: string; programs: Program[] }

export const DOCUMENTARIES_GUIDE_ID = 'science-documentaries';

export function getDocumentaryChannels(): DocumentaryChannel[] {
  const byGroup = new Map<string, Entry[]>();
  for (const entry of manifest as Entry[]) {
    if (!entry.u || !entry.t) continue;
    const list = byGroup.get(entry.g) ?? [];
    list.push(entry);
    byGroup.set(entry.g, list);
  }
  const channels: DocumentaryChannel[] = [];
  for (const [group, entries] of byGroup) {
    const channelId = `doc-${slug(group)}`;
    entries.sort((a, b) => (a.s ?? 0) - (b.s ?? 0) || (a.e ?? 0) - (b.e ?? 0));
    const sourceId = normalizeSourceIdentity({ channelId, url: `library:documentaries:${group}`, protocol: 'direct_archive' });
    const programs = entries.map((entry): Program => {
      const { mediaUrl, archivePath } = playableUrl(entry.u);
      const externalId = `${entry.id}|${entry.u}`;
      const programId = normalizeProgramIdentity({ externalId, channelId, title: entry.t, startTime: 0 });
      return {
        id: programId,
        guideId: DOCUMENTARIES_GUIDE_ID,
        channelId,
        title: entry.t,
        description: group,
        startTime: 0,
        endTime: 0,
        mediaType: 'video',
        mediaUrl,
        archivePath,
        assetId: normalizeAssetIdentity({ externalId, archiveIdentifier: entry.id, programId, mediaUrl: archivePath ?? entry.u }),
        sourceId,
        sourceClass: 'archive_org',
        isArchivedSource: true,
        metadata: { externalId, season: entry.s ?? undefined, episode: entry.e ?? undefined, durationSeconds: entry.d && entry.d > 0 ? entry.d : undefined, durationSource: entry.d ? 'library' : 'unknown' },
      } as Program;
    });
    channels.push({ id: channelId, name: group.length > 48 ? `${group.slice(0, 45)}…` : group, logo: entries[0].id ? `https://archive.org/services/img/${entries[0].id}` : undefined, programs });
  }
  return channels.sort((a, b) => b.programs.length - a.programs.length);
}
