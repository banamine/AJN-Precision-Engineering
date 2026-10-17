import type { NewsProvider, ParsedNewsInput } from "../contract";

const VIDEO_ID = /^[\w-]{11}$/;
const YOUTUBE_WATCH_HOST = "www.youtube.com";
const YOUTUBE_SHORT_HOST = "youtu.be";

function urlHasExactAuthority(text: string, host: string): boolean {
  const authority = text.match(/^https:\/\/([^/?#]+)/i)?.[1];
  return typeof authority === "string" && authority.toLowerCase() === host;
}

function parsedPageUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    if (url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.port !== "") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function parseInput(text: string): ParsedNewsInput | null {
  const input = text.trim();
  if (VIDEO_ID.test(input)) return { provider: "youtube", kind: "id", id: input };

  const url = parsedPageUrl(input);
  if (!url) return null;

  if (url.hostname === YOUTUBE_WATCH_HOST
    && urlHasExactAuthority(input, YOUTUBE_WATCH_HOST)
    && url.pathname === "/watch") {
    const ids = url.searchParams.getAll("v");
    if (ids.length !== 1 || !VIDEO_ID.test(ids[0])) return null;
    return {
      provider: "youtube",
      kind: "page",
      id: ids[0],
      pageUrl: `https://${YOUTUBE_WATCH_HOST}/watch?v=${encodeURIComponent(ids[0])}`,
    };
  }

  if (url.hostname === YOUTUBE_SHORT_HOST
    && urlHasExactAuthority(input, YOUTUBE_SHORT_HOST)
    && /^\/[\w-]{11}$/.test(url.pathname)) {
    const id = url.pathname.slice(1);
    return {
      provider: "youtube",
      kind: "page",
      id,
      pageUrl: `https://${YOUTUBE_SHORT_HOST}/${encodeURIComponent(id)}`,
    };
  }
  return null;
}

export const youtubeProvider: NewsProvider = {
  id: "youtube",
  parseInput,
  embedSrc(embedId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(embedId)}`;
  },
  lookupUrlForEmbed(embedId) {
    return `https://${YOUTUBE_WATCH_HOST}/watch?v=${encodeURIComponent(embedId)}`;
  },
  oembedUrl(pageUrl) {
    return `https://${YOUTUBE_WATCH_HOST}/oembed?format=json&url=${encodeURIComponent(pageUrl)}`;
  },
  extractEmbedId(html) {
    const match = html.match(/https:\/\/www\.youtube\.com\/embed\/([\w-]{11})(?:[?&#"'\\\s]|$)/);
    return match && VIDEO_ID.test(match[1]) ? match[1] : null;
  },
};
