// Picture for an AJN item that has no thumbnail of its own. A real thumbnail always wins; these are the supplied show images.
// Anything naming Alex / Infowars / Sunday Night Live / AJN gets the Alex picture; War Room gets the War Room picture.
// Items from the AJN feeds pass their feedId, so an unrecognised show there still counts as AJN. Unrelated video gets nothing.
export const AJN_ART = {
  liveStream: '/ajn-art/alex-live-stream.jpg',        // "Watch video or audio live stream - Alex Jones Show"
  alexVideo: '/ajn-art/alex-show-video.jpg',          // "Alex Jones Show"
  warRoomVideo: '/ajn-art/warroom-video-or-audio.jpg', // "Video or Audio - War Room"
  warRoomAudio: '/ajn-art/warroom-audio-podcast.jpg',  // "Audio/Podcast - War Room"
  audioGeneric: '/ajn-art/audio-podcast.jpg',          // "Audio/Podcast"
} as const;

export interface AjnArtQuery {
  /** AJN feed id ("Alex", "WarRoom", "SundayLive", ...) when known. */
  feedId?: string;
  /** Show name or title text ("Alex Jones", "War Room · Hour 2"). */
  show?: string;
  mediaType?: string;
  /** A live stream entry (not an archived episode). */
  live?: boolean;
}

const WAR_RE = /war\s*room/;
const ALEX_RE = /alex|info\s*wars|sunday\s*(night\s*)?live|ajn/;

/** True when the text names the Alex Jones network, Infowars or War Room. */
export function isAjnRelated(text: string): boolean {
  const t = text.toLowerCase();
  return WAR_RE.test(t) || ALEX_RE.test(t);
}

/** onlyAjn: return art only for AJN / Infowars / War Room items (used by the guide, which lists many non-AJN channels). */
export function ajnArtFor(q: AjnArtQuery & { onlyAjn?: boolean }): string | undefined {
  const text = `${q.feedId ?? ''} ${q.show ?? ''}`.toLowerCase();
  const war = WAR_RE.test(text);
  const alex = !war && ALEX_RE.test(text);
  const audio = q.mediaType === 'audio';
  if (q.onlyAjn && !war && !alex) return undefined;
  if (alex && q.live) return AJN_ART.liveStream;
  if (war) return audio ? AJN_ART.warRoomAudio : AJN_ART.warRoomVideo;
  if (alex) return audio ? AJN_ART.audioGeneric : AJN_ART.alexVideo;
  return audio ? AJN_ART.audioGeneric : undefined;
}
