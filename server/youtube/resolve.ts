import { findYoutubeChannel } from "../../src/youtube/registry";
import { isYoutubeChannelId, isYoutubeVideoId } from "../../src/youtube/validate";
import type {
  YoutubeFailure,
  YoutubeLatestResponse,
  YoutubeLatestVideo,
} from "../../src/youtube/types";

const FEED_BASE_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const FEED_TIMEOUT_MS = 5000;
const MAX_FEED_BYTES = 512 * 1024;
const SUCCESS_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_FETCHES = 3;
const FEED_ATTEMPTS = 3;
const FEED_RETRY_DELAYS_MS = [400, 800] as const;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ParsedYoutubeFeed {
  channelName: string;
  video: YoutubeLatestVideo;
}

interface CacheEntry {
  expiresAt: number;
  value: Extract<YoutubeLatestResponse, { ok: true }>;
}

export interface ResolveYoutubeOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const successCache = new Map<string, CacheEntry>();
let concurrentFetches = 0;

export function clearYoutubeLatestCache(): void {
  successCache.clear();
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    const numeric = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : entity;
  });
}

function extractTag(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function extractAuthorName(xml: string): string | null {
  const match = xml.match(/<author(?:\s[^>]*)?>[\s\S]*?<name(?:\s[^>]*)?>([\s\S]*?)<\/name\s*>[\s\S]*?<\/author\s*>/i);
  const name = match ? decodeXml(match[1].trim()) : "";
  return name || null;
}

function extractViews(entry: string): number | null {
  const match = entry.match(/<media:statistics\b[^>]*\bviews\s*=\s*["'](\d+)["'][^>]*\/?>/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseYoutubeFeed(xml: string, expectedChannelId: string): ParsedYoutubeFeed | null {
  if (!isYoutubeChannelId(expectedChannelId) || !xml.trim() || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/gi)];
  if (entries.length === 0) return null;

  // Current YouTube feeds abbreviate the top-level channelId, but each entry carries
  // the full canonical channel ID. Validate every entry against that ID.
  const channelName = extractAuthorName(xml) ?? extractAuthorName(entries[0][1]);
  if (!channelName) return null;

  const videos: YoutubeLatestVideo[] = [];
  for (const match of entries) {
    const entry = match[1];
    const videoId = extractTag(entry, "yt:videoId");
    const channelId = extractTag(entry, "yt:channelId");
    const title = extractTag(entry, "title");
    const publishedAt = extractTag(entry, "published");
    if (channelId !== expectedChannelId
      || !isYoutubeVideoId(videoId)
      || !title
      || !publishedAt
      || !Number.isFinite(Date.parse(publishedAt))) {
      return null;
    }
    videos.push({
      videoId,
      title,
      publishedAt,
      views: extractViews(entry),
    });
  }

  videos.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  return { channelName, video: videos[0] };
}

async function readLimitedBody(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_FEED_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function failureOrStale(
  channelId: string,
  reason: YoutubeFailure,
): YoutubeLatestResponse {
  const previous = successCache.get(channelId);
  return previous
    ? { ...previous.value, stale: true, reason }
    : { ok: false, reason };
}

export async function resolveYoutubeChannelLatest(
  registryId: string,
  options: ResolveYoutubeOptions = {},
): Promise<YoutubeLatestResponse> {
  const channel = findYoutubeChannel(registryId);
  if (!channel) return { ok: false, reason: "invalid-input" };

  const now = options.now ?? Date.now;
  const cached = successCache.get(channel.id);
  if (cached && cached.expiresAt > now()) return cached.value;

  if (concurrentFetches >= MAX_CONCURRENT_FETCHES) {
    return failureOrStale(channel.id, "rate-limited");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FEED_TIMEOUT_MS);
  concurrentFetches += 1;

  try {
    let lastFailure: YoutubeFailure = "upstream-error";
    for (let attempt = 0; attempt < FEED_ATTEMPTS; attempt += 1) {
      if (controller.signal.aborted) {
        lastFailure = "timeout";
        break;
      }
      try {
        const response = await fetchImpl(`${FEED_BASE_URL}${encodeURIComponent(channel.channelId)}`, {
          signal: controller.signal,
          redirect: "error",
          headers: { Accept: "application/atom+xml, application/xml, text/xml" },
        });
        if (response.status === 429) {
          lastFailure = "rate-limited";
        } else if (!response.ok) {
          lastFailure = "upstream-error";
        } else {
          const xml = await readLimitedBody(response);
          if (xml === null) {
            lastFailure = "bad-response";
          } else {
            const parsed = parseYoutubeFeed(xml, channel.channelId);
            if (!parsed) {
              lastFailure = "bad-response";
            } else {
              const asOf = new Date(now()).toISOString();
              const result: Extract<YoutubeLatestResponse, { ok: true }> = {
                ok: true,
                channel: { id: channel.id, name: parsed.channelName || channel.name },
                video: parsed.video,
                thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(parsed.video.videoId)}/hqdefault.jpg`,
                asOf,
                stale: false,
              };
              successCache.set(channel.id, { expiresAt: now() + SUCCESS_TTL_MS, value: result });
              return result;
            }
          }
        }
      } catch (error) {
        const timedOut = controller.signal.aborted
          || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
        lastFailure = timedOut ? "timeout" : "upstream-error";
        if (timedOut) break;
      }

      if (attempt < FEED_RETRY_DELAYS_MS.length && !controller.signal.aborted) {
        await sleep(FEED_RETRY_DELAYS_MS[attempt]);
      }
    }
    return failureOrStale(channel.id, controller.signal.aborted ? "timeout" : lastFailure);
  } finally {
    clearTimeout(timer);
    concurrentFetches -= 1;
  }
}
