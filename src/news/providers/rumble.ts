import type { NewsProvider, ParsedNewsInput } from "../contract";

const ID = "v[a-z0-9]{3,12}";
const PAGE_PATH = new RegExp(`^/(${ID})-[^/?#\\s]*\\.html$`, "i");
const EMBED_URL = new RegExp(`^https://rumble\\.com/embed/(${ID})/?(?:[?#].*)?$`, "i");
const BARE_ID = new RegExp(`^(${ID})$`, "i");
const EMBED_IN_HTML = new RegExp(`rumble\\.com/embed/(${ID})/`, "i");

/** Strict: https, host exactly rumble.com (or www.), no userinfo/port, one path segment ending .html. */
export function parseRumblePageUrl(text: string): { id: string; pageUrl: string } | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  if (url.hostname !== "rumble.com" && url.hostname !== "www.rumble.com") return null;
  const match = url.pathname.match(PAGE_PATH);
  if (!match) return null;
  const id = match[1].toLowerCase();
  // Tracking query (?e9s=...) is dropped on purpose; only the path identifies the video.
  return { id, pageUrl: `https://rumble.com${url.pathname}` };
}

/**
 * Rumble's oEmbed needs a page URL with a slug, but ANY slug works for a real id
 * (VERIFIED 2026-10-06: v7gdv2i-x.html, -v.html, -video.html all resolve; bare id and
 * slug-less .html return 404). So a stored video id is enough to build a lookup URL.
 */
export function rumblePageUrlForVideoId(videoId: string): string {
  return `https://rumble.com/${videoId.toLowerCase()}-video.html`;
}

export const rumbleProvider: NewsProvider = {
  id: "rumble",

  parseInput(text: string): ParsedNewsInput | null {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return null;

    const embed = trimmed.match(EMBED_URL);
    if (embed) return { provider: "rumble", kind: "embed", id: embed[1].toLowerCase() };

    const bare = trimmed.match(BARE_ID);
    if (bare) return { provider: "rumble", kind: "id", id: bare[1].toLowerCase() };

    const page = parseRumblePageUrl(trimmed);
    if (page) return { provider: "rumble", kind: "page", id: page.id, pageUrl: page.pageUrl };

    return null;
  },

  embedSrc(embedId: string): string {
    return `https://rumble.com/embed/${encodeURIComponent(embedId)}/?pub=4`;
  },

  /** VERIFIED 2026-10-06: Rumble oEmbed accepts https://rumble.com/embed/<id>/ and returns the same embed id. */
  lookupUrlForEmbed(embedId: string): string {
    return `https://rumble.com/embed/${embedId}/`;
  },

  oembedUrl(pageUrl: string): string {
    return `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(pageUrl)}`;
  },

  extractEmbedId(html: string): string | null {
    const match = String(html ?? "").match(EMBED_IN_HTML);
    return match ? match[1].toLowerCase() : null;
  },
};
