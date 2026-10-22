import type { ScheduleChannel } from '../src/types';
import { fold, numberChannels } from '../src/guide/channelIndex';

export interface ClassicTitleMatch {
  channelId: string;
  titles: string[];
}

interface IndexedProgramTitle {
  title: string;
  folded: string;
}

interface IndexedChannel {
  channelId: string;
  nameHay: string;
  combinedHay: string;
  programTitles: IndexedProgramTitle[];
}

export interface ClassicProgramTitleIndex {
  readonly channels: readonly IndexedChannel[];
}

// The cached schedule array is the identity of one schedule load. Weak keys
// release their index when the schedule is replaced or no longer referenced.
const titleIndexes = new WeakMap<readonly ScheduleChannel[], ClassicProgramTitleIndex>();

export function getClassicProgramTitleIndex(
  schedule: readonly ScheduleChannel[],
): ClassicProgramTitleIndex {
  const cached = titleIndexes.get(schedule);
  if (cached) return cached;

  const channels: IndexedChannel[] = numberChannels(schedule).map(({ channel, station }) => {
    const nameHay = `${fold(channel.name)} ${fold(channel.group ?? '')} ${station}`;
    const programTitles = (channel.programs ?? [])
      .map((program) => ({ title: program.title, folded: fold(program.title) }))
      .filter((program) => program.folded.length > 0);
    return {
      channelId: channel.id,
      nameHay,
      combinedHay: `${nameHay} ${programTitles.map((program) => program.folded).join(' ')}`,
      programTitles,
    };
  });
  const index: ClassicProgramTitleIndex = { channels };
  titleIndexes.set(schedule, index);
  return index;
}

export function searchClassicProgramTitles(
  schedule: readonly ScheduleChannel[],
  query: string,
): ClassicTitleMatch[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [];

  const matches: ClassicTitleMatch[] = [];
  for (const indexed of getClassicProgramTitleIndex(schedule).channels) {
    if (!terms.every((term) => indexed.combinedHay.includes(term))) continue;
    const neededTerms = terms.filter((term) => !indexed.nameHay.includes(term));
    const titleEvidence = new Map<string, string>();
    for (const term of neededTerms) {
      const hit = indexed.programTitles.find((program) => program.folded.includes(term));
      if (hit) titleEvidence.set(hit.title, hit.title);
    }
    matches.push({ channelId: indexed.channelId, titles: [...titleEvidence.values()] });
  }
  return matches;
}
