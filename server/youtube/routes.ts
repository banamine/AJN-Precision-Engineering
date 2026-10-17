import type {
  Express,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import { YOUTUBE_REGISTRY } from "../../src/youtube/registry";
import { resolveYoutubeChannelLatest } from "./resolve";
import { isAllowedYoutubeUrl, parseYoutubePlaylistId } from "../../src/youtube/validate";
import type { YoutubeFailure, YoutubePlaylistResolveResponse } from "../../src/youtube/types";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const MAX_TRACKED_IPS = 5000;
const PLAYLIST_LOOKUP_TIMEOUT_MS = 4000;
const MAX_OEMBED_BYTES = 32 * 1024;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<globalThis.Response>;

interface YoutubeRouteOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface IpWindow {
  startedAt: number;
  count: number;
}

const ipWindows = new Map<string, IpWindow>();

function failure(res: ExpressResponse, reason: YoutubeFailure): ExpressResponse {
  return res.status(200).json({ ok: false, reason });
}

async function readOembedBody(response: globalThis.Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_OEMBED_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_OEMBED_BYTES) {
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

async function resolvePlaylistOembed(
  playlistId: string,
  fetchImpl: FetchLike,
  now: () => number,
): Promise<YoutubePlaylistResolveResponse> {
  const playlistUrl = new URL("https://www.youtube.com/playlist");
  playlistUrl.searchParams.set("list", playlistId);
  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("url", playlistUrl.toString());
  oembedUrl.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(oembedUrl, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (response.status === 429) return { ok: false, reason: "rate-limited" };
    if (!response.ok) return { ok: false, reason: "upstream-error" };
    const body = await readOembedBody(response);
    if (!body) return { ok: false, reason: "bad-response" };
    const payload: unknown = JSON.parse(body);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { ok: false, reason: "bad-response" };
    }
    const record = payload as Record<string, unknown>;
    if (record.type !== "video"
      || typeof record.title !== "string"
      || !record.title.trim()
      || record.title.length > 300
      || typeof record.thumbnail_url !== "string"
      || !isAllowedYoutubeUrl(record.thumbnail_url)
      || new URL(record.thumbnail_url).hostname !== "i.ytimg.com") {
      return { ok: false, reason: "bad-response" };
    }
    return {
      ok: true,
      playlist: {
        id: playlistId,
        title: record.title.trim(),
        thumbnailUrl: record.thumbnail_url,
        verifiedAt: new Date(now()).toISOString().slice(0, 10),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted
        || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
        ? "timeout"
        : "upstream-error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isRateLimited(ip: string, now = Date.now()): boolean {
  if (ipWindows.size >= MAX_TRACKED_IPS) {
    for (const [key, window] of ipWindows) {
      if (now - window.startedAt >= RATE_LIMIT_WINDOW_MS) ipWindows.delete(key);
    }
    if (ipWindows.size >= MAX_TRACKED_IPS) ipWindows.clear();
  }

  const current = ipWindows.get(ip);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    ipWindows.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= RATE_LIMIT_MAX) return true;
  current.count += 1;
  return false;
}

export function clearYoutubeRouteRateLimits(): void {
  ipWindows.clear();
}

export function registerYoutubeRoutes(app: Express, options: YoutubeRouteOptions = {}): void {
  app.get("/api/youtube/channels", (_req: ExpressRequest, res: ExpressResponse) => {
    return res.status(200).json(YOUTUBE_REGISTRY);
  });

  app.get("/api/youtube/channel-latest", async (req: ExpressRequest, res: ExpressResponse) => {
    if (process.env.YOUTUBE_WALL_ENABLED === "false") return failure(res, "disabled");

    const registryId = req.query.channel;
    if (typeof registryId !== "string") return failure(res, "invalid-input");

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) return failure(res, "rate-limited");

    const result = await resolveYoutubeChannelLatest(registryId);
    return res.status(200).json(result);
  });

  app.post("/api/youtube/playlist-resolve", async (req: ExpressRequest, res: ExpressResponse) => {
    if (process.env.YOUTUBE_WALL_ENABLED === "false") return failure(res, "disabled");
    const playlistId = parseYoutubePlaylistId(req.body?.url);
    if (!playlistId) return failure(res, "invalid-input");
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) return failure(res, "rate-limited");
    const result = await resolvePlaylistOembed(playlistId, options.fetchImpl ?? fetch, options.now ?? Date.now);
    return res.status(200).json(result);
  });
}
