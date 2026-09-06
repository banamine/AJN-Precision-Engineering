/**
 * newsFeed.ts
 * Forward-engineered from news.json (353 rows / 30 Internet Archive TV News items).
 *
 * The chunking math here reproduces the observed file exactly on 30/30 items.
 * The URL builder is the corrected version — see NEWS_JSON_SPEC.md §6 before
 * flipping CLIP_MODE to 'server'.
 */

// ---------------------------------------------------------------------------
// 1. Contract
// ---------------------------------------------------------------------------

export interface Clip {
  id: string;
  parentId: string;
  chunkIndex: number;
  channel: string;
  show: string;
  airedAt: string;          // ISO 8601 — parsed from parentId (currently null upstream)
  startSec: number;
  endSec: number;
  durationSec: number;
  mediaUrl: string;         // clipped URL when server-side clipping is confirmed
  parentUrl: string;        // ALWAYS the unclipped parent — required for clamping
  posterUrl: string;
  captionsUrl: string | null;
  description: string;
}

export interface SourceItem {
  identifier: string;             // e.g. FOXNEWSW_20260905_220000_The_Big_Weekend_Show
  totalSec: number | null;        // null => metadata not yet available
  description: string;
  captionVariant: CaptionVariant | null;
}

export type CaptionVariant = 'align' | 'cc5' | 'asr';

/** Quality order observed in news.json. First available wins. */
export const CAPTION_PREFERENCE: readonly CaptionVariant[] = ['align', 'cc5', 'asr'] as const;

/**
 * Chunk ceiling. news.json used 300.
 * The IA TV3 player config exposes CLIP_SEC_MAX; a reference implementation
 * observed 180. VERIFY before trusting 300 (spec §6, secondary check).
 */
export const MAX_CHUNK_SEC = 300;

/** Assumed hour length when the metadata call returns no duration. */
export const FALLBACK_TOTAL_SEC = 3600;

/**
 * 'server'  — emit ?t=S/E&ignore=x.mp4 (only after the Phase 1 curls pass)
 * 'clamp'   — emit the bare parent URL; the player enforces the window
 *
 * Default is 'clamp' because it is correct under both outcomes.
 */
export type ClipMode = 'server' | 'clamp';
export const CLIP_MODE: ClipMode = 'clamp';

// ---------------------------------------------------------------------------
// 2. Identifier parsing — recovers the airDate that news.json leaves null
// ---------------------------------------------------------------------------

const IDENT_RE = /^([A-Z0-9]+)_(\d{8})_(\d{6})_(.+)$/;

export interface ParsedIdentifier {
  channel: string;
  show: string;
  airedAt: string;
}

export function parseIdentifier(identifier: string): ParsedIdentifier | null {
  const m = IDENT_RE.exec(identifier);
  if (!m) return null;

  const [, channel, ymd, hms, rawShow] = m;
  const iso =
    `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` +
    `T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;

  return { channel, show: rawShow.replace(/_/g, ' '), airedAt: iso };
}

// ---------------------------------------------------------------------------
// 3. The chunking formula — verified 30/30 against news.json
// ---------------------------------------------------------------------------

export interface ChunkWindow {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

/**
 * n = ceil(T / MAX_CHUNK_SEC)   chunk count
 * d = ceil(T / n)               even length, so the tail is never a runt
 * last chunk is clamped to T
 */
export function computeChunks(totalSec: number, maxChunkSec = MAX_CHUNK_SEC): ChunkWindow[] {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return [];

  const n = Math.ceil(totalSec / maxChunkSec);
  const d = Math.ceil(totalSec / n);

  return Array.from({ length: n }, (_, index) => {
    const startSec = index * d;
    const endSec = Math.min(startSec + d, totalSec);
    return { index, startSec, endSec, durationSec: endSec - startSec };
  });
}

// ---------------------------------------------------------------------------
// 4. URL builders
// ---------------------------------------------------------------------------

const IA_DOWNLOAD = 'https://archive.org/download';
const IA_THUMB = 'https://archive.org/services/img';

export function parentMediaUrl(identifier: string): string {
  return `${IA_DOWNLOAD}/${identifier}/${identifier}.mp4`;
}

/**
 * Corrected clip URL.
 *
 * news.json emitted `?exact=1&start=S&end=E`, which the Internet Archive does
 * not recognise; unknown params on a static file endpoint are ignored, so every
 * chunk resolved to the same full-hour file. The documented form is a single
 * `t` parameter with a slash-separated range plus a filename hint.
 */
export function clippedMediaUrl(identifier: string, startSec: number, endSec: number): string {
  return `${parentMediaUrl(identifier)}?t=${startSec}/${endSec}&ignore=x.mp4`;
}

export function posterUrl(identifier: string): string {
  return `${IA_THUMB}/${identifier}`;
}

export function captionsUrl(identifier: string, variant: CaptionVariant | null): string | null {
  if (!variant) return null;
  return `${IA_DOWNLOAD}/${identifier}/${identifier}.${variant}.srt`;
}

export function pickCaptionVariant(available: readonly string[]): CaptionVariant | null {
  return CAPTION_PREFERENCE.find((v) => available.includes(v)) ?? null;
}

// ---------------------------------------------------------------------------
// 5. Generator
// ---------------------------------------------------------------------------

export function buildClips(items: readonly SourceItem[], mode: ClipMode = CLIP_MODE): Clip[] {
  const out: Clip[] = [];

  for (const item of items) {
    const parsed = parseIdentifier(item.identifier);
    if (!parsed) {
      // Unparseable identifier is a distinct outcome from "no chunks".
      // Do not silently emit an empty list — surface it.
      console.warn(`[newsFeed] unparseable identifier, skipped: ${item.identifier}`);
      continue;
    }

    const totalSec = item.totalSec ?? FALLBACK_TOTAL_SEC;
    const parent = parentMediaUrl(item.identifier);

    for (const w of computeChunks(totalSec)) {
      out.push({
        id: `${item.identifier}_seg0000_c${w.index}`,
        parentId: item.identifier,
        chunkIndex: w.index,
        channel: parsed.channel,
        show: parsed.show,
        airedAt: parsed.airedAt,
        startSec: w.startSec,
        endSec: w.endSec,
        durationSec: w.durationSec,
        mediaUrl:
          mode === 'server'
            ? clippedMediaUrl(item.identifier, w.startSec, w.endSec)
            : parent,
        parentUrl: parent,
        posterUrl: posterUrl(item.identifier),
        captionsUrl: captionsUrl(item.identifier, item.captionVariant),
        description: item.description,
      });
    }
  }

  return out;
}

/** Reproduces the title format used in news.json (verified 353/353). */
export function clipTitle(clip: Clip): string {
  const d = new Date(clip.airedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  const offset = `${p(Math.floor(clip.startSec / 3600))}:${p(Math.floor((clip.startSec % 3600) / 60))}`;
  return `${clip.show} [${stamp}] ${offset}`;
}

// ---------------------------------------------------------------------------
// 6. Exporters — "plays in any web player"
// ---------------------------------------------------------------------------

/**
 * Extended M3U. Absolute MP4 URLs + honest #EXTINF durations is the lowest
 * common denominator every player reads: VLC, Kodi, TiviMate, hls.js, native.
 *
 * NOTE: M3U has no concept of a play window. Under mode 'clamp' the durations
 * are correct but external players will still start each entry at 00:00.
 * Only export M3U once server-side clipping is confirmed.
 */
export function toM3U(clips: readonly Clip[]): string {
  const lines = ['#EXTM3U'];

  for (const c of clips) {
    lines.push(
      `#EXTINF:${c.durationSec} tvg-id="${c.parentId}" tvg-name="${escapeAttr(c.show)}" ` +
        `tvg-logo="${c.posterUrl}" group-title="${escapeAttr(`${c.channel} ${c.show}`)}",` +
        escapeAttr(clipTitle(c)),
    );
    lines.push(c.mediaUrl);
  }

  return lines.join('\n') + '\n';
}

/** XMLTV EPG. airedAt + startSec is what the null airDate field currently blocks. */
export function toXMLTV(clips: readonly Clip[]): string {
  const stamp = (iso: string, offsetSec: number) => {
    const t = new Date(new Date(iso).getTime() + offsetSec * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
      `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())} +0000`
    );
  };

  const channels = [...new Set(clips.map((c) => c.channel))]
    .map((ch) => `  <channel id="${ch}"><display-name>${escapeXml(ch)}</display-name></channel>`)
    .join('\n');

  const programmes = clips
    .map(
      (c) =>
        `  <programme start="${stamp(c.airedAt, c.startSec)}" ` +
        `stop="${stamp(c.airedAt, c.endSec)}" channel="${c.channel}">\n` +
        `    <title>${escapeXml(c.show)}</title>\n` +
        `    <desc>${escapeXml(c.description)}</desc>\n` +
        `    <icon src="${c.posterUrl}"/>\n` +
        `  </programme>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${channels}\n${programmes}\n</tv>\n`;
}

const escapeAttr = (s: string) => s.replace(/"/g, '&quot;');
const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// 7. Playback — clamped window on a progressive MP4
// ---------------------------------------------------------------------------

/**
 * This is a progressive MP4, not HLS. Do not route it through hls.js:
 * there is no manifest, no demuxer to manage, and no destroy() lifecycle.
 * Assign src directly and let the browser range-request.
 *
 * Reports durationSec from the record rather than video.duration, because
 * under mode 'clamp' the element sees the full parent (~3600s) and every
 * progress bar, EPG block, and auto-advance timer downstream would be wrong.
 */
export interface ClampHandle {
  detach: () => void;
}

export function attachClipWindow(
  video: HTMLVideoElement,
  clip: Clip,
  onWindowEnd?: () => void,
): ClampHandle {
  let seeded = false;

  const onLoadedMetadata = () => {
    if (seeded) return;
    seeded = true;
    // Repeated currentTime writes during buffering cancel in-flight range
    // requests, so seed exactly once and tolerate a 1.5s landing window.
    if (Math.abs(video.currentTime - clip.startSec) > 1.5) {
      video.currentTime = clip.startSec;
    }
  };

  const onTimeUpdate = () => {
    if (!seeded) return;
    if (video.currentTime >= clip.endSec) {
      video.pause();
      onWindowEnd?.();
    } else if (video.currentTime < clip.startSec - 1.5) {
      // Guard against a stray seek dropping out of the window.
      video.currentTime = clip.startSec;
    }
  };

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.src = clip.mediaUrl;

  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeAttribute('src');
      video.load();
    },
  };
}

/** Position within the clip window, for a progress bar that tells the truth. */
export function windowProgress(video: HTMLVideoElement, clip: Clip): { elapsed: number; total: number } {
  return {
    elapsed: Math.max(0, Math.min(video.currentTime - clip.startSec, clip.durationSec)),
    total: clip.durationSec,
  };
}

// ---------------------------------------------------------------------------
// 8. Proxy fallback — MediaError code 3 (DECODE) / 4 (SRC_NOT_SUPPORTED)
// ---------------------------------------------------------------------------

export function proxyUrl(direct: string): string {
  return `/api/stream-proxy?url=${encodeURIComponent(direct)}`;
}

/**
 * Each attempt gets its OWN AbortController. A shared controller hands an
 * already-aborted signal to every fallback after the first.
 * AbortSignal.timeout() is prohibited here — it throws DataCloneError in the
 * Worker deployment context.
 */
export async function probeSource(url: string, timeoutMs = 8000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

export function shouldProxy(err: MediaError | null): boolean {
  return err?.code === MediaError.MEDIA_ERR_DECODE || err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
}
