import type { Program } from '../src/types';

/** Packaged TV News snapshot: grouped shows with real air times (no day layout,
 *  no proxy URLs). Loaded at startup so the guide opens without an Archive search. */
export interface NewsSnapshotChannel { id: string; network: string; name: string; programs: Program[]; }
export interface NewsSnapshot { schema: 1; version: number; fetchedAt: string; channels: NewsSnapshotChannel[]; }

/** Returns the snapshot if it is structurally sound, otherwise null. */
export function validateNewsSnapshot(raw: unknown): NewsSnapshot | null {
  const s = raw as NewsSnapshot;
  if (!s || s.schema !== 1 || !Array.isArray(s.channels) || !Date.parse(s.fetchedAt)) return null;
  const channels = s.channels
    .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.programs))
    .map((c) => ({ ...c, programs: c.programs.filter((p) => typeof p?.archivePath === 'string' && p.archivePath.startsWith('/download/')) }));
  if (!channels.some((c) => c.programs.length)) return null;
  return { ...s, channels };
}

/** Strip runtime-only fields so the file stays small and holds one URL form. */
export function toSnapshotProgram(p: Program): Program {
  const m: any = { ...(p.metadata ?? {}) };
  if (Array.isArray(m.segments)) m.segments = m.segments.map(({ mediaUrl: _u, ...s }: any) => s);
  const { mediaUrl: _m, ...rest } = p as any;
  return { ...rest, mediaUrl: p.archivePath, metadata: m } as Program;
}

/** Stable fingerprint of what is playable: changes only when shows change. */
export function newsFingerprint(chs: Array<{ programs: Program[] }>): string {
  let h = 0;
  for (const c of chs) for (const p of c.programs) for (const ch of String(p.archivePath)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
