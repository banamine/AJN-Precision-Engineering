import type { Program } from '../types';

/** A truthful info card for channels that have no curated showInfo.json entry.
 *  Every line comes from the channel's own schedule data; nothing is invented. */
export interface FallbackShowInfo {
  title: string;
  subtitle: string;
  overview: string;
  facts: string[];
  link: { href: string; label: string } | null;
}

interface FallbackChannel {
  id: string;
  name: string;
  group?: string;
  mediaType?: string;
  programs: Array<Pick<Program, 'title' | 'archivePath' | 'metadata' | 'startTimeUtc'>>;
  sourceStatus?: string;
  sourceError?: string;
}

const ARCHIVE_ID = /^\/download\/([^/?#]+)\//;

function archiveIdentifierOf(program: FallbackChannel['programs'][number]): string | null {
  const fromMeta = program.metadata?.externalId;
  const m = ARCHIVE_ID.exec(String(program.archivePath ?? ''));
  const raw = m ? decodeURIComponent(m[1]) : (typeof fromMeta === 'string' ? fromMeta.replace(/_c\d+$/, '') : '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(raw) ? raw : null;
}

function dayOf(iso: string): string { return iso.slice(0, 10); }

const cache = new WeakMap<object, { name: string; status?: string; value: FallbackShowInfo }>();

/** Memoised on the channel's programs array so the guide's frequent re-renders stay cheap. */
export function buildFallbackShowInfo(channel: FallbackChannel): FallbackShowInfo {
  const hit = cache.get(channel.programs);
  if (hit && hit.name === channel.name && hit.status === channel.sourceStatus) return hit.value;
  const value = computeFallback(channel);
  cache.set(channel.programs, { name: channel.name, status: channel.sourceStatus, value });
  return value;
}

function computeFallback(channel: FallbackChannel): FallbackShowInfo {
  const programs = channel.programs ?? [];
  const kind = channel.mediaType === 'audio' ? 'audio' : 'video';
  const group = channel.group?.trim();
  const titles = new Set(programs.map((p) => String(p.title).replace(/\s+\d{2}:\d{2}$/, '')));
  const overview = programs.length
    ? `${channel.name} is a ${kind} channel${group ? ` in the “${group}” group` : ''}. It has ${programs.length} scheduled program${programs.length === 1 ? '' : 's'} in today’s guide.`
    : `${channel.name} is a ${kind} channel${group ? ` in the “${group}” group` : ''}. Nothing is scheduled for it in today’s guide${channel.sourceError ? `: ${channel.sourceError}` : ''}.`;

  const facts: string[] = [];
  if (programs.length) facts.push(`${titles.size} distinct title${titles.size === 1 ? '' : 's'} today`);
  const aired = programs.map((p) => String(p.metadata?.airedUtc ?? '')).filter(Boolean).sort();
  if (aired.length) facts.push(`Originally aired ${dayOf(aired[0])}${dayOf(aired[aired.length - 1]) !== dayOf(aired[0]) ? ` to ${dayOf(aired[aired.length - 1])}` : ''} (UTC)`);
  const archived = programs.find((p) => archiveIdentifierOf(p));
  if (archived) facts.push('Source: Internet Archive');
  if (channel.sourceStatus && channel.sourceStatus !== 'ok') facts.push(`Source status: ${channel.sourceStatus}`);

  const id = archived ? archiveIdentifierOf(archived) : null;
  return {
    title: channel.name,
    subtitle: [group, kind === 'audio' ? 'Audio' : 'Video'].filter(Boolean).join(' · '),
    overview,
    facts,
    link: id ? { href: `https://archive.org/details/${encodeURIComponent(id)}`, label: 'Open on Internet Archive' } : null,
  };
}
