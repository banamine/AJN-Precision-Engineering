// Pure helpers for Archive TV News caption slices. No network, no Express.
// Rules (owner decisions 2026-10-16/17):
//  - Only time-sliced requests (?t=S/E) to caption files; never a full-file request.
//  - Three source kinds are kept separate: 'aligned', 'broadcast-cc', 'asr'.
//  - Caption text is held in memory only: never written to disk, logged or cached by the server.

export type CaptionKind = 'aligned' | 'broadcast-cc' | 'asr';
export type CaptionSuffix = 'align' | 'cc5' | 'asr';

export const SLICE_SECONDS = 60;
export const MAX_SLICE_START = 4 * 3600; // longest program this feature will address
export const MAX_SLICE_BODY_BYTES = 256 * 1024; // real slices are about 2 kB

/** Priority: align > cc5 > asr > none. */
const PRIORITY: Array<{ suffix: CaptionSuffix; kind: CaptionKind }> = [
  { suffix: 'align', kind: 'aligned' },
  { suffix: 'cc5', kind: 'broadcast-cc' },
  { suffix: 'asr', kind: 'asr' },
];

export const KIND_LABEL: Record<CaptionKind, string> = {
  aligned: 'Broadcast closed captions via Internet Archive',
  'broadcast-cc': 'Broadcast closed captions via Internet Archive',
  asr: 'Automatic speech recognition by Internet Archive, not broadcaster captions',
};

/** TV News identifiers look like NETWORK_YYYYMMDD_HHMMSS[_Show_Name]. */
export const TV_NEWS_ID = /^[A-Za-z0-9]{2,20}_\d{8}_\d{6}(?:_[A-Za-z0-9._-]{0,150})?$/;

export function isTvNewsId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 200 && TV_NEWS_ID.test(id) && !id.includes('..');
}

export function networkOfId(id: string): string {
  return id.split('_')[0].toUpperCase();
}

export function isCaptionSuffix(v: unknown): v is CaptionSuffix {
  return v === 'align' || v === 'cc5' || v === 'asr';
}

export function kindOfSuffix(suffix: CaptionSuffix): CaptionKind {
  return PRIORITY.find((p) => p.suffix === suffix)!.kind;
}

export interface ArchiveFileEntry { name?: string; [k: string]: unknown }

/** Choose one caption file from an item's public file list. File names only; nothing is requested here. */
export function pickCaptionFile(id: string, files: ArchiveFileEntry[]): { suffix: CaptionSuffix; kind: CaptionKind; file: string } | null {
  const names = new Set(files.map((f) => String(f?.name ?? '')));
  for (const p of PRIORITY) {
    const file = `${id}.${p.suffix}.srt`;
    if (names.has(file)) return { suffix: p.suffix, kind: p.kind, file };
  }
  return null;
}

export function validSliceStart(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SLICE_START && v % SLICE_SECONDS === 0;
}

/** The only upstream URL this feature ever builds. */
export function captionSliceUrl(id: string, suffix: CaptionSuffix, sliceStart: number): string {
  return `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(`${id}.${suffix}.srt`)}?t=${sliceStart}/${sliceStart + SLICE_SECONDS}`;
}

export interface Cue { start: number; end: number; text: string }

const TS = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
function toSeconds(m: RegExpExecArray): number {
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Parse SRT text into raw cues (times as written in the file). Tolerant of '.' or ',' decimals and CRLF. */
export function parseSrt(body: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = String(body ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const ma = TS.exec(a ?? ''); const mb = TS.exec(b ?? '');
    if (!ma || !mb) continue;
    const text = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = toSeconds(ma); const end = toSeconds(mb);
    if (!(end >= start)) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/**
 * Convert raw cue times to seconds from the start of the program.
 * Measured on cc5 (2026-10-16): times restart at 0 in every slice (RELATIVE). ASR was not measured, so
 * a slice whose earliest cue already sits at or after its own start (>= sliceStart - 0.5, sliceStart > 0)
 * is treated as ABSOLUTE and is not shifted. For sliceStart 0 both readings are identical.
 */
export function toProgramTime(raw: Cue[], sliceStart: number): { cues: Cue[]; timeBase: 'relative' | 'absolute' } {
  if (raw.length === 0) return { cues: [], timeBase: 'relative' };
  const minStart = Math.min(...raw.map((c) => c.start));
  const absolute = sliceStart > 0 && minStart >= sliceStart - 0.5;
  const shift = absolute ? 0 : sliceStart;
  return { cues: raw.map((c) => ({ start: c.start + shift, end: c.end + shift, text: c.text })), timeBase: absolute ? 'absolute' : 'relative' };
}

export function retryAfterSeconds(header: string | null | undefined, now: number, fallback = 30, cap = 120): number {
  const h = String(header ?? '').trim();
  if (!h) return fallback;
  if (/^\d+$/.test(h)) return Math.min(Math.max(Number(h), 1), cap);
  const t = Date.parse(h);
  if (Number.isFinite(t)) return Math.min(Math.max(Math.ceil((t - now) / 1000), 1), cap);
  return fallback;
}
