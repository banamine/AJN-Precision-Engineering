import type { Program } from '../types';

/** A truthful info card for channels that have no curated showInfo.json entry.
 *  Every line comes from the channel's own schedule data; nothing is invented. */
export interface FallbackShowInfo {
  title: string;
  subtitle: string;
  overview: string;
  facts: string[];
}

interface FallbackChannel {
  id: string;
  name: string;
  group?: string;
  mediaType?: string;
  programs: Array<Pick<Program, 'title' | 'metadata' | 'archivePath' | 'startTimeUtc'>>;
  rotationTitleCount?: number;
  sourceStatus?: string;
  sourceError?: string;
}

function dayOf(iso: string): string { return iso.slice(0, 10); }

const cache = new WeakMap<object, { name: string; rotationTitleCount?: number; value: FallbackShowInfo }>();

/** Memoised on the channel's programs array so the guide's frequent re-renders stay cheap. */
export function buildFallbackShowInfo(channel: FallbackChannel): FallbackShowInfo {
  const hit = cache.get(channel.programs);
  if (hit && hit.name === channel.name && hit.rotationTitleCount === channel.rotationTitleCount) return hit.value;
  const value = computeFallback(channel);
  cache.set(channel.programs, { name: channel.name, rotationTitleCount: channel.rotationTitleCount, value });
  return value;
}

function computeFallback(channel: FallbackChannel): FallbackShowInfo {
  const programs = channel.programs ?? [];
  const kind = channel.mediaType === 'audio' ? 'audio' : 'video';
  const group = channel.group?.trim();
  const overview = programs.length
    ? `${channel.name} is a ${kind} channel${group ? ` in the “${group}” group` : ''}. It has ${programs.length} scheduled program${programs.length === 1 ? '' : 's'} in today’s guide.`
    : `${channel.name} is a ${kind} channel${group ? ` in the “${group}” group` : ''}. Nothing is scheduled for it in today’s guide${channel.sourceError ? `: ${channel.sourceError}` : ''}.`;

  const facts: string[] = [
    `${programs.length} program${programs.length === 1 ? '' : 's'} today${Number.isInteger(channel.rotationTitleCount) && channel.rotationTitleCount! >= 0
      ? ` · ${channel.rotationTitleCount} distinct title${channel.rotationTitleCount === 1 ? '' : 's'} in rotation`
      : ''}`,
  ];
  const aired = programs.map((p) => String(p.metadata?.airedUtc ?? '')).filter(Boolean).sort();
  if (aired.length) facts.push(`Originally aired ${dayOf(aired[0])}${dayOf(aired[aired.length - 1]) !== dayOf(aired[0]) ? ` to ${dayOf(aired[aired.length - 1])}` : ''} (UTC)`);
  return {
    title: channel.name,
    subtitle: [group, kind === 'audio' ? 'Audio' : 'Video'].filter(Boolean).join(' · '),
    overview,
    facts,
  };
}
