/* One rule set for choosing the file to play from an Archive item's files[].
 * Decides by Archive's `format` field (not the extension), skips private files,
 * records why a file was chosen and where its duration came from. No network. */

export type LibraryAvailability = 'verified' | 'unverified' | 'unavailable' | 'unsupported';
export type DurationSource = 'file-length' | 'item-runtime' | 'default';
export interface SelectedMedia {
  canonicalPath: string;           // /download/<id>/<file>, each part URL-encoded
  filename: string;
  format: string;
  mediaType: 'video' | 'audio';
  durationSeconds: number;
  durationSource: DurationSource;
  durationEstimated: boolean;
  availability: LibraryAvailability;
  selectedBecause: string;
}

/** Browser-playable Archive formats, best first. */
export const VIDEO_FORMATS = ['h.264', 'h.264 IA', 'MPEG4', '512Kb MPEG4', 'WebM'];
export const AUDIO_FORMATS = ['VBR MP3', '128Kbps MP3', '64Kbps MP3', 'MP3', 'Ogg Vorbis'];
const EXT: Record<'video' | 'audio', RegExp> = { video: /\.(mp4|m4v|webm)$/i, audio: /\.(mp3|ogg)$/i };
export const DEFAULT_DURATION_SECONDS = 1800;

/** "1823.4", "30:23", "00:30:23", "28 minutes", "1 hr 5 min" -> seconds (0 if unusable). */
export function parseDuration(v: unknown): number {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) return Math.round(s.split(':').reduce((t, p) => t * 60 + Number(p), 0));
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(s), m = /(\d+(?:\.\d+)?)\s*m/.exec(s), sec = /(\d+)\s*s/.exec(s);
  const total = (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
  return Number.isFinite(total) ? Math.round(total) : 0;
}

export const canonicalArchivePath = (identifier: string, filename: string) =>
  `/download/${encodeURIComponent(identifier)}/${filename.split('/').map(encodeURIComponent).join('/')}`;

export function selectPlayableFile(identifier: string, files: unknown, itemRuntime: unknown, mediaType: 'video' | 'audio', fallbackSeconds = DEFAULT_DURATION_SECONDS): SelectedMedia {
  const formats = mediaType === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS;
  const ok = (Array.isArray(files) ? files : []).filter((f: any) =>
    typeof f?.name === 'string' && String(f.private) !== 'true' && formats.includes(String(f.format)) && EXT[mediaType].test(f.name));
  if (!ok.length) return { canonicalPath: '', filename: '', format: 'none', mediaType, durationSeconds: 0, durationSource: 'default', durationEstimated: true, availability: 'unsupported', selectedBecause: `no web-playable ${mediaType} file` };
  ok.sort((a: any, b: any) => formats.indexOf(String(a.format)) - formats.indexOf(String(b.format)) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const f: any = ok[0];
  const fileLen = parseDuration(f.length), runtime = parseDuration(itemRuntime);
  const [durationSeconds, durationSource]: [number, DurationSource] = fileLen > 0 ? [fileLen, 'file-length'] : runtime > 0 ? [runtime, 'item-runtime'] : [fallbackSeconds, 'default'];
  return {
    canonicalPath: canonicalArchivePath(identifier, f.name), filename: f.name, format: String(f.format), mediaType,
    durationSeconds, durationSource, durationEstimated: durationSource === 'default',
    availability: 'unverified',
    selectedBecause: `format "${f.format}" (choice ${formats.indexOf(String(f.format)) + 1} of ${formats.length})`,
  };
}
