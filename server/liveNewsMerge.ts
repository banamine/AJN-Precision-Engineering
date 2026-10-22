// Cable TV "Live News" = curated live news (server/liveNewsChannels.ts) + every Live TV guide channel in group "News".
// One list, no duplicates: a stream URL that appears twice is listed once (the curated Live News row wins).
// Pure function: no network, no clock. The caller supplies both lists.
import type { ScheduleChannel } from '../src/types';
import { LIVE_NEWS_GROUP } from './liveNewsChannels';

const urlOf = (ch: ScheduleChannel): string => ch.programs[0]?.mediaUrl ?? '';

export function mergeLiveTvNews(
  guideId: string,
  liveNews: ScheduleChannel[],
  liveTv: ScheduleChannel[],
  reservedNames: Iterable<string> = [],
): ScheduleChannel[] {
  const reserved = new Set([...reservedNames].map((n) => n.trim().toLowerCase()));
  const seenUrl = new Set(liveNews.map(urlOf).filter(Boolean));
  const seenId = new Set(liveNews.map((c) => c.id));
  const added: ScheduleChannel[] = [];
  const candidates = liveTv
    .filter((c) => c.group === 'News' && urlOf(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const c of candidates) {
    const url = urlOf(c);
    if (seenUrl.has(url)) continue;
    seenUrl.add(url);
    let id = c.id;
    if (seenId.has(id)) { let n = 2; while (seenId.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    seenId.add(id);
    const name = reserved.has(c.name.trim().toLowerCase()) && !/ LIVE$/.test(c.name) ? `${c.name} LIVE` : c.name;
    added.push({
      ...c,
      id,
      guideId,
      name,
      group: LIVE_NEWS_GROUP,
      programs: c.programs.map((p) => ({
        ...p,
        guideId,
        channelId: id,
        title: p.title === c.name ? name : p.title,
        description: `Live · ${LIVE_NEWS_GROUP}`,
        metadata: { ...(p.metadata ?? {}), group: LIVE_NEWS_GROUP, live: true },
      })),
    });
  }
  return [...liveNews, ...added];
}
