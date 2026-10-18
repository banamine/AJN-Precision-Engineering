import type { Program, ScheduleChannel } from '../src/types';
import { fold, numberChannels } from '../src/guide/channelIndex';

export interface ClassicTitleMatch {
  channelId: string;
  titles: string[];
}

export function searchClassicProgramTitles(channels: readonly ScheduleChannel[], query: string): ClassicTitleMatch[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [];
  const matches: ClassicTitleMatch[] = [];
  for (const { channel, station } of numberChannels([...channels])) {
    const nameHay = `${fold(channel.name)} ${fold(channel.group ?? '')} ${station}`;
    const programTitles = (channel.programs ?? []).map((program: Program) => ({ title: program.title, folded: fold(program.title) }));
    const combinedHay = `${nameHay} ${programTitles.map((program) => program.folded).join(' ')}`;
    if (!terms.every((term) => combinedHay.includes(term))) continue;
    const neededTerms = terms.filter((term) => !nameHay.includes(term));
    const titleEvidence = new Map<string, string>();
    for (const term of neededTerms) {
      const hit = programTitles.find((program) => program.folded.includes(term));
      if (hit) titleEvidence.set(hit.title, hit.title);
    }
    matches.push({ channelId: channel.id, titles: [...titleEvidence.values()] });
  }
  return matches;
}
