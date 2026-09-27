/* Library, built on the server from the guides the server already builds (and
 * caches). No Archive calls of its own. Item ids are the programs' own ids
 * without the daily slot suffix, so favorites (stored by id in the browser)
 * keep pointing at the same item from day to day. */
import type { LibraryItem, Program, ScheduleChannel } from '../src/types';

type Category = LibraryItem['category'];
export const LIBRARY_SOURCES: Array<{ guideId: string; category: (ch: ScheduleChannel) => Category | null }> = [
  { guideId: 'cable-tv', category: () => 'news' },
  { guideId: 'science-documentaries', category: (ch) => (ch.id === 'nasa-missions' || ch.id === 'nova-wonders' ? 'science' : 'documentary') },
  { guideId: 'movies-classics-vault', category: () => 'classics' },
  { guideId: 'classic-tv', category: () => 'classics' },
  { guideId: 'audio-podcasts', category: (ch) => (ch.mediaType === 'audio' ? 'audio' : null) },
];
const PER_CHANNEL = 60, PER_CATEGORY = 400;
export const baseProgramId = (id: string) => id.replace(/:d\d+$/, '');

export function fmtDuration(p: Program): string {
  const s = Number((p.metadata as any)?.durationSeconds) || (p.endTimeUtc && p.startTimeUtc ? (Date.parse(p.endTimeUtc) - Date.parse(p.startTimeUtc)) / 1000 : 0);
  if (!(s > 0)) return 'Archive program';
  const est = (p.metadata as any)?.durationEstimated ? '~' : '';
  return s >= 3600 ? `${est}${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${est}${Math.max(1, Math.round(s / 60))} min`;
}

export function libraryFromChannels(groups: Array<{ guideId: string; channels: ScheduleChannel[]; category: (ch: ScheduleChannel) => Category | null }>): LibraryItem[] {
  const seen = new Set<string>();
  const perCat = new Map<Category, number>();
  const out: LibraryItem[] = [];
  for (const g of groups) for (const ch of g.channels) {
    const cat = g.category(ch);
    if (!cat) continue;
    let n = 0;
    for (const p of ch.programs ?? []) {
      if (n >= PER_CHANNEL || (perCat.get(cat) ?? 0) >= PER_CATEGORY) break;
      const media = p.archivePath || p.mediaUrl;
      const m = (p.metadata ?? {}) as any;
      if (!media || m.live) continue;
      const id = baseProgramId(p.id);
      if (seen.has(id)) continue;
      seen.add(id); n++; perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
      const sc = p.sourceClass === 'ajn_archive' || p.sourceClass === 'ajn_rss' ? p.sourceClass : 'archive_org';
      out.push({
        id, programId: id, title: p.title, description: p.description || ch.name,
        category: cat, archivePath: media, duration: fmtDuration(p),
        format: p.mediaType === 'audio' ? 'Audio' : 'Video',
        year: m.year ? String(m.year) : (m.airedUtc || m.date) ? String(m.airedUtc || m.date).slice(0, 4) : undefined,
        source: ch.name, tags: Array.isArray(m.tags) && m.tags.length ? m.tags.slice(0, 4) : [ch.group || cat].filter(Boolean).map((t) => String(t).toLowerCase()),
        channelId: ch.id, guideId: g.guideId, isCurated: true,
        sourceId: p.sourceId ?? m.sourceId ?? '', assetId: p.assetId ?? m.assetId ?? '', sourceClass: sc,
        mediaType: p.mediaType,
      } as LibraryItem);
    }
  }
  return out;
}
