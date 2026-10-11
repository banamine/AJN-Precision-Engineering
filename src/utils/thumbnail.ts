/* Thumbnail resolution for guide rows and library cards. Pure functions only (no network, no DOM).
 * Order of attempts: episode frame -> Archive item image -> captured frame (only for items Archive had no image for) -> local backup image.
 * The <Thumb> component walks this list on image errors and finally shows an initials tile, so a card is never an empty box
 * and a broken image is never shown. */
export type ThumbSource = 'episode-frame' | 'item-image' | 'captured' | 'backup';
export interface ThumbCandidate { url: string; source: ThumbSource }
export interface ThumbInput {
  /** Archive identifier, or null when unknown. */
  identifier?: string | null;
  /** Any reference that contains the identifier: /download/<id>/..., archive.org URL, or /api/archive/proxy?path=... */
  path?: string | null;
  /** Archive frame path inside the item, e.g. "<id>.thumbs/<episode>_000486.jpg" (recorded by npm run series:build). */
  frameFile?: string | null;
  guideId?: string | null;
  category?: string | null;
  mediaType?: string | null;
  channelId?: string | null;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const ARCHIVE_IMG_BASE = 'https://archive.org/services/img/';
const DOWNLOAD_BASE = 'https://archive.org/download/';

/** Pull the Archive identifier out of the reference formats this app uses. Returns null (never a guess) when there is none. */
export function archiveIdentifierFromPath(ref?: string | null): string | null {
  if (!ref) return null;
  let value = String(ref).trim();
  try {
    const q = value.indexOf('/api/archive/proxy');
    if (q >= 0) { const p = new URL(value, 'https://x.invalid').searchParams.get('path'); if (p) value = p; }
  } catch { /* fall through with the raw value */ }
  const m = value.match(/(?:^|\/)(?:download|details)\/([^/?#]+)/);
  if (!m) return null;
  let id = m[1];
  try { id = decodeURIComponent(id); } catch { return null; }
  return ID_RE.test(id) ? id : null;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function archiveItemImageUrl(identifier: string): string { return `${ARCHIVE_IMG_BASE}${encodeURIComponent(identifier)}`; }
export function archiveFrameUrl(identifier: string, frameFile: string): string { return `${DOWNLOAD_BASE}${encodeURIComponent(identifier)}/${encodePath(frameFile)}`; }

/** Small local images shipped in public/thumbs (192x105 JPEG, about 9 KB each). */
export function backupThumb(i: Pick<ThumbInput, 'guideId' | 'category' | 'mediaType' | 'channelId'> = {}): string {
  const ch = String(i.channelId ?? '').toLowerCase();
  if (/alex|war-?room|infowars|ajn/.test(ch)) return '/thumbs/alex-jones-show.jpg';
  if (/emergency/.test(ch)) return '/thumbs/emergency-broadcast.jpg';
  const g = String(i.guideId ?? '').toLowerCase();
  const c = String(i.category ?? '').toLowerCase();
  if (g === 'live-tv') return '/thumbs/live.jpg';
  if (g === 'audio-podcasts' || c === 'audio' || i.mediaType === 'audio') return '/thumbs/audio-podcast.jpg';
  if (c === 'news' || g === 'cable-tv') return '/thumbs/special-report.jpg';
  if (c === 'documentary' || c === 'science' || g === 'science-documentaries') return '/thumbs/daily-highlights.jpg';
  return '/thumbs/classic-archive.jpg';
}

/** Ordered, de-duplicated candidates. `captured` is a data URL saved from a real playing frame (see thumbStore). */
export function thumbCandidates(i: ThumbInput, captured?: string | null): ThumbCandidate[] {
  const id = i.identifier && ID_RE.test(i.identifier) ? i.identifier : archiveIdentifierFromPath(i.path);
  const out: ThumbCandidate[] = [];
  if (id && i.frameFile) out.push({ url: archiveFrameUrl(id, i.frameFile), source: 'episode-frame' });
  if (id) out.push({ url: archiveItemImageUrl(id), source: 'item-image' });
  if (captured && captured.startsWith('data:image/jpeg;base64,')) out.push({ url: captured, source: 'captured' });
  out.push({ url: backupThumb(i), source: 'backup' });
  return out.filter((c, n, a) => a.findIndex((x) => x.url === c.url) === n);
}

/** Up to two letters for the last-resort tile. */
export function initialsOf(title?: string | null): string {
  const words = String(title ?? '').normalize('NFKD').replace(/['\u2019]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'TV';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
