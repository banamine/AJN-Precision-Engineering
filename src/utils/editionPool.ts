/* Adapts a built daily Edition (src/utils/dailyEdition.ts) to the schedule engine's pool shape. Pure. */
import type { Edition, EditionSlot, ShelfEpisode } from './dailyEdition';
import type { SchedPool, SchedTrack } from './roundRobinSchedule';

export const EDITION_POOL_ID = 'today-podcasts';
export const EDITION_POOL_LABEL = 'Today’s podcasts';

export function shelfTrack(e: ShelfEpisode | EditionSlot): SchedTrack {
  return { programId: e.programId, archiveId: e.guid, partNo: 1, bank: 'podcasts', poolId: EDITION_POOL_ID, channelId: e.channelId, guideId: 'audio-podcasts',
    title: e.title, subtitle: e.showName, src: e.src, durationSeconds: e.durationSeconds };
}

/** The edition's loop then its Yesterday/Replay tail as one list of back-to-back slots. Nothing is clipped at UTC midnight. */
export function editionToPool(ed: Edition): SchedPool {
  const slots = [...ed.loop, ...ed.tail].map((s) => ({ track: shelfTrack(s), startUtcMs: s.startMs, endUtcMs: s.endMs, label: s.label }));
  return { id: EDITION_POOL_ID, label: EDITION_POOL_LABEL, bank: 'podcasts', items: [], edition: { id: ed.editionId, startMs: ed.startMs, endMs: ed.endMs, loopEndMs: ed.loopEndMs, slots } };
}
