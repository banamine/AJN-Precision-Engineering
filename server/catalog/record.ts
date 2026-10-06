/* One Archive item -> one catalog record (or an exclusion / failure). Pure, no Node APIs, no network.
 * Playable file choice reuses the shared selector (server/archive/mediaSelector.ts); nothing here downloads media. */
import { selectPlayableFile, parseDuration, canonicalArchivePath, VIDEO_FORMATS, AUDIO_FORMATS } from '../archive/mediaSelector';
import { englishLabel, findSexWord, plainText } from './rules';
import { inferGenres } from './genres';

export type SourceKind = 'favorite' | 'upload' | 'collection';
export interface CatalogSource { kind: SourceKind; via?: string }
export interface CatalogFile { path: string; name: string; format: string; sizeBytes?: number; md5?: string; durationSeconds: number; durationEstimated: boolean }
export type RecordStatus = 'playable' | 'not-playable' | 'collection';
export interface CatalogRecord {
  id: string; sourceUrl: string; sources: CatalogSource[];
  displayTitle: string; originalTitle: string; genres: string[];
  archiveMediatype: string; mediaType: 'video' | 'audio' | 'collection' | 'other';
  year?: number; creator?: string; thumbnailUrl?: string; thumbnailSource?: 'item-thumb-file' | 'frame-thumbs' | 'archive-service';
  status: RecordStatus; reason?: string;
  selected?: CatalogFile; alternates?: CatalogFile[]; playableFileCount?: number; episodeCount?: number;
  pairing?: { audio: CatalogFile; video: CatalogFile };
  alsoIdentifiers?: string[]; reviewFlags?: string[];
  collection?: { memberCount: number; expanded: boolean; reason?: string };
}
export type BuildResult =
  | { kind: 'record'; record: CatalogRecord }
  | { kind: 'excluded'; id: string; reason: string }
  | { kind: 'failed'; id: string; reason: string };

const EXT: Record<'video' | 'audio', RegExp> = { video: /\.(mp4|m4v|webm)$/i, audio: /\.(mp3|ogg)$/i };
const yearOf = (v: unknown) => { const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(v ?? '')); return m ? Number(m[1]) : undefined; };
const first = (v: unknown) => String(Array.isArray(v) ? v[0] : v ?? '').trim();

/** Name without folder-independent quality suffixes, so "x.mp4", "x_512kb.mp4" and "x.ia.mp4" are versions of one program. */
export function stemOf(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/\.ia$/, '').replace(/[_\- ](512kb|64kb|128kb|h264|hd|sd)$/, '');
}
const isPrivate = (f: any) => String(f?.private) === 'true';
const sourceKey = (s: CatalogSource) => `${s.kind}:${s.via ?? ''}`;
export function mergeSources(a: CatalogSource[], b: CatalogSource[]): CatalogSource[] {
  const m = new Map<string, CatalogSource>(); for (const s of [...a, ...b]) m.set(sourceKey(s), s); return [...m.values()];
}

function toFile(identifier: string, sel: ReturnType<typeof selectPlayableFile>, files: any[]): CatalogFile {
  const f = files.find((x) => x?.name === sel.filename) ?? {};
  const size = Number(f.size);
  return { path: sel.canonicalPath, name: sel.filename, format: sel.format, sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined,
    md5: typeof f.md5 === 'string' ? f.md5 : undefined, durationSeconds: sel.durationSeconds, durationEstimated: sel.durationEstimated };
}

/** Poster image: the item's own thumbnail file, else a middle frame from <id>.thumbs/, else Archive's image service. */
export function pickThumbnail(identifier: string, files: any[]): Pick<CatalogRecord, 'thumbnailUrl' | 'thumbnailSource'> {
  const names = files.map((f) => String(f?.name ?? ''));
  const url = (n: string) => `https://archive.org${canonicalArchivePath(identifier, n)}`;
  const own = names.find((n) => /^__ia_thumb\.jpg$/i.test(n));
  if (own) return { thumbnailUrl: url(own), thumbnailSource: 'item-thumb-file' };
  const frames = names.filter((n) => /\.thumbs\/[^/]+\.jpe?g$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (frames.length) return { thumbnailUrl: url(frames[Math.floor(frames.length / 2)]), thumbnailSource: 'frame-thumbs' };
  return { thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`, thumbnailSource: 'archive-service' };
}

/** `meta` is the Archive /metadata/<id> response (or the reduced form kept in the build cache). */
export function buildCatalogRecord(id: string, meta: any, sources: CatalogSource[]): BuildResult {
  const m = meta?.metadata;
  if (!m || typeof m !== 'object') return { kind: 'failed', id, reason: 'metadata unavailable' };
  if (meta.is_dark) return { kind: 'failed', id, reason: 'item withdrawn (dark)' };

  // Item-level text rule: any whole-word hit in these fields drops every candidate of the item.
  const hit = findSexWord({ title: m.title, description: m.description, subject: m.subject, keywords: m.keywords, tags: m.tags });
  if (hit) return { kind: 'excluded', id, reason: `whole word "sex" in ${hit}` };

  const archiveMediatype = String(m.mediatype ?? '');
  const originalTitle = plainText(first(m.title)).replace(/\s+/g, ' ').trim() || id;
  const base = {
    id, sourceUrl: `https://archive.org/details/${encodeURIComponent(id)}`, sources,
    displayTitle: englishLabel(originalTitle, id), originalTitle,
    genres: inferGenres({ collection: m.collection, subject: m.subject, title: originalTitle }),
    archiveMediatype, year: yearOf(m.year) ?? yearOf(m.date), creator: first(m.creator) || undefined,
  };
  const files: any[] = Array.isArray(meta.files) ? meta.files : [];
  const thumb = pickThumbnail(id, files);
  const notPlayable = (mediaType: CatalogRecord['mediaType'], reason: string): BuildResult => ({ kind: 'record', record: { ...base, ...thumb, mediaType, status: 'not-playable', reason } });

  if (archiveMediatype === 'collection') return { kind: 'record', record: { ...base, ...thumb, mediaType: 'collection', status: 'collection' } };
  const type: 'video' | 'audio' | null = archiveMediatype === 'movies' ? 'video' : (archiveMediatype === 'audio' || archiveMediatype === 'etree') ? 'audio' : null;
  if (!type) return notPlayable('other', `Archive mediatype "${archiveMediatype || 'unknown'}" is not audio or video`);
  if (String(m['access-restricted-item']) === 'true') return notPlayable(type, 'access restricted (loan or private item)');

  // File-level rule: a file whose own name has the whole word is dropped; clean siblings stay eligible.
  const eligible = files.filter((f) => typeof f?.name === 'string' && !isPrivate(f) && !findSexWord({ filename: f.name }));
  const sel = selectPlayableFile(id, eligible, m.runtime, type);
  if (sel.availability === 'unsupported') return notPlayable(type, sel.selectedBecause);

  const selected = toFile(id, sel, eligible);
  const formats = type === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS;
  const playable = eligible.filter((f) => formats.includes(String(f.format)) && EXT[type].test(f.name));
  const stem = stemOf(sel.filename);
  let rest = playable.filter((f) => f.name !== sel.filename && stemOf(f.name) === stem);
  const alternates: CatalogFile[] = [];
  for (let i = 0; i < 4 && rest.length; i++) {
    const a = selectPlayableFile(id, rest, m.runtime, type);
    if (a.availability === 'unsupported') break;
    alternates.push(toFile(id, a, rest)); rest = rest.filter((f) => f.name !== a.filename);
  }

  let pairing: CatalogRecord['pairing'];
  if (type === 'video') {
    const au = selectPlayableFile(id, eligible, m.runtime, 'audio');
    if (au.availability !== 'unsupported' && stemOf(au.filename) === stem) {
      const aud = toFile(id, au, eligible);
      const bothTimed = !selected.durationEstimated && !aud.durationEstimated;
      if (!bothTimed || Math.abs(aud.durationSeconds - selected.durationSeconds) <= 2) pairing = { audio: aud, video: selected };
    }
  }
  return { kind: 'record', record: { ...base, ...thumb, mediaType: type, status: 'playable', selected, alternates: alternates.length ? alternates : undefined,
    playableFileCount: playable.length, episodeCount: new Set(playable.map((f) => stemOf(f.name))).size, pairing } };
}
