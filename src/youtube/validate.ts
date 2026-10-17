import {
  YOUTUBE_GROUPS,
  type YoutubeChannel,
  type YoutubeChannelRegistry,
  type YoutubeFailure,
  type YoutubeLatestResponse,
  type YoutubePanelSelection,
  type YoutubePlaylist,
  type YoutubePlaylistCatalog,
  type YoutubePlaylistResolveResponse,
} from "./types";

const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{2,60}$/;
const REGISTRY_ID_PATTERN = /^yt-[a-z0-9-]{2,60}$/;
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "i.ytimg.com",
  "www.youtube-nocookie.com",
]);
const FAILURE_REASONS = new Set<YoutubeFailure>([
  "invalid-input",
  "timeout",
  "upstream-error",
  "bad-response",
  "rate-limited",
  "disabled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isYoutubeChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value);
}

export function isYoutubeHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

export function isYoutubeRegistryId(value: unknown): value is string {
  return typeof value === "string" && REGISTRY_ID_PATTERN.test(value);
}

export function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID_PATTERN.test(value);
}

export function isYoutubePlaylistId(value: unknown): value is string {
  return typeof value === "string" && PLAYLIST_ID_PATTERN.test(value);
}

export function parseYoutubePlaylistId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase();
    if (!["www.youtube.com", "youtube.com", "youtu.be"].includes(hostname)) return null;
    if (hostname !== "youtu.be"
      && !["/playlist", "/watch", "/embed/videoseries"].includes(url.pathname)) {
      return null;
    }
    const playlistIds = url.searchParams.getAll("list");
    return playlistIds.length === 1 && isYoutubePlaylistId(playlistIds[0])
      ? playlistIds[0]
      : null;
  } catch {
    return null;
  }
}

export function isAllowedYoutubeHost(value: string): boolean {
  return ALLOWED_HOSTS.has(value.toLowerCase());
}

export function isAllowedYoutubeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.port === ""
      && isAllowedYoutubeHost(url.hostname);
  } catch {
    return false;
  }
}

function isYoutubeChannel(value: unknown): value is YoutubeChannel {
  if (!isRecord(value)) return false;
  const optionalRankValid = value.pdfRank === undefined
    || (typeof value.pdfRank === "number" && Number.isInteger(value.pdfRank) && value.pdfRank > 0);
  const optionalPdfSubscribersValid = value.pdfSubscribers === undefined
    || isNonEmptyString(value.pdfSubscribers);
  const optionalPageSubscribersValid = value.pageSubscribers === undefined
    || isNonEmptyString(value.pageSubscribers);
  return isYoutubeRegistryId(value.id)
    && isNonEmptyString(value.name)
    && isYoutubeHandle(value.handle)
    && isYoutubeChannelId(value.channelId)
    && typeof value.group === "string"
    && YOUTUBE_GROUPS.includes(value.group as (typeof YOUTUBE_GROUPS)[number])
    && (value.region === "us" || value.region === "intl")
    && optionalRankValid
    && optionalPdfSubscribersValid
    && optionalPageSubscribersValid
    && (value.main === undefined || typeof value.main === "boolean")
    && typeof value.verifiedAt === "string"
    && Number.isFinite(Date.parse(value.verifiedAt));
}

export function isYoutubePlaylist(value: unknown): value is YoutubePlaylist {
  if (!isRecord(value)
    || !isYoutubePlaylistId(value.id)
    || !isNonEmptyString(value.title)
    || value.title.length > 300
    || !isAllowedYoutubeUrl(value.thumbnailUrl)
    || new URL(value.thumbnailUrl).hostname !== "i.ytimg.com"
    || typeof value.verifiedAt !== "string"
    || !Number.isFinite(Date.parse(value.verifiedAt))) {
    return false;
  }
  return true;
}

export function getYoutubePlaylistCatalogErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["catalog must be an object"];
  if (value.version !== 1) errors.push("version must be 1");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    errors.push("generatedAt must be a valid date");
  }
  if (!isNonEmptyString(value.note)) errors.push("note must be a non-empty string");
  if (!Array.isArray(value.channels) || value.channels.length === 0 || value.channels.length > 20) {
    errors.push("channels must contain between 1 and 20 entries");
    return errors;
  }
  const registryIds = new Set<string>();
  for (const [index, channel] of value.channels.entries()) {
    if (!isRecord(channel)
      || !isYoutubeRegistryId(channel.registryId)
      || !isYoutubeChannelId(channel.channelId)
      || !["partial", "complete"].includes(String(channel.completeness))
      || !isRecord(channel.live)
      || !isYoutubeVideoId(channel.live.embedId)
      || channel.live.status !== "unverified"
      || channel.live.suppliedBy !== "user"
      || typeof channel.live.suppliedAt !== "string"
      || !Number.isFinite(Date.parse(channel.live.suppliedAt))
      || !Array.isArray(channel.playlists)
      || channel.playlists.length > 5000) {
      errors.push(`channels[${index}] is invalid`);
      continue;
    }
    if (registryIds.has(channel.registryId)) errors.push(`duplicate registry id: ${channel.registryId}`);
    registryIds.add(channel.registryId);
    const playlistIds = new Set<string>();
    channel.playlists.forEach((playlist, playlistIndex) => {
      if (!isYoutubePlaylist(playlist)) {
        errors.push(`channels[${index}].playlists[${playlistIndex}] is invalid`);
      } else if (playlistIds.has(playlist.id)) {
        errors.push(`duplicate playlist id: ${playlist.id}`);
      } else {
        playlistIds.add(playlist.id);
      }
    });
  }
  return errors;
}

export function validateYoutubePlaylistCatalog(value: unknown): value is YoutubePlaylistCatalog {
  return getYoutubePlaylistCatalogErrors(value).length === 0;
}

export function validateYoutubePlaylistResolveResponse(value: unknown): value is YoutubePlaylistResolveResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return FAILURE_REASONS.has(value.reason as YoutubeFailure);
  return isYoutubePlaylist(value.playlist);
}

export function getYoutubeRegistryErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["registry must be an object"];
  if (value.version !== 2) errors.push("version must be 2");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    errors.push("generatedAt must be a valid date");
  }
  if (!isNonEmptyString(value.note)) errors.push("note must be a non-empty string");
  if (!Array.isArray(value.channels)) {
    errors.push("channels must be an array");
  } else {
    if (value.channels.length === 0) errors.push("channels must not be empty");
    if (value.channels.length > 150) errors.push("channels must not exceed 150");
    const ids = new Set<string>();
    const channelIds = new Set<string>();
    value.channels.forEach((channel, index) => {
      if (!isYoutubeChannel(channel)) {
        errors.push(`channels[${index}] is invalid`);
        return;
      }
      if (ids.has(channel.id)) errors.push(`duplicate registry id: ${channel.id}`);
      ids.add(channel.id);
      if (channelIds.has(channel.channelId)) errors.push(`duplicate channelId: ${channel.channelId}`);
      channelIds.add(channel.channelId);
    });
  }
  if (!Array.isArray(value.defaultSlots)) {
    errors.push("defaultSlots must be an array");
  } else {
    if (value.defaultSlots.length > 4) errors.push("defaultSlots must not exceed 4");
    const defaults = new Set<string>();
    value.defaultSlots.forEach((id) => {
      if (!isYoutubeRegistryId(id)) {
        errors.push("defaultSlots entries must be registry ids");
      } else if (defaults.has(id)) {
        errors.push(`duplicate default slot: ${id}`);
      } else {
        defaults.add(id);
        if (Array.isArray(value.channels) && !value.channels.some((channel) => (
          isRecord(channel) && channel.id === id
        ))) {
          errors.push(`default slot does not exist: ${id}`);
        }
      }
    });
  }
  return errors;
}

export function validateYoutubeRegistry(value: unknown): value is YoutubeChannelRegistry {
  return getYoutubeRegistryErrors(value).length === 0;
}

export function validateYoutubePanels(panels: readonly YoutubePanelSelection[]): boolean {
  if (panels.length > 4) return false;
  const videoIds = new Set<string>();
  for (const panel of panels) {
    if (panel.videoId === null) continue;
    if (!isYoutubeVideoId(panel.videoId) || videoIds.has(panel.videoId)) return false;
    videoIds.add(panel.videoId);
  }
  return true;
}

export function validateYoutubeLatestResponse(value: unknown): value is YoutubeLatestResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return FAILURE_REASONS.has(value.reason as YoutubeFailure);
  if (!isRecord(value.channel) || !isYoutubeRegistryId(value.channel.id) || !isNonEmptyString(value.channel.name)) {
    return false;
  }
  if (!isRecord(value.video)
    || !isYoutubeVideoId(value.video.videoId)
    || !isNonEmptyString(value.video.title)
    || typeof value.video.publishedAt !== "string"
    || !Number.isFinite(Date.parse(value.video.publishedAt))
    || !(value.video.views === null
      || (typeof value.video.views === "number" && Number.isInteger(value.video.views) && value.video.views >= 0))) {
    return false;
  }
  if (!isAllowedYoutubeUrl(value.thumbnailUrl)
    || new URL(value.thumbnailUrl).hostname !== "i.ytimg.com"
    || typeof value.asOf !== "string"
    || !Number.isFinite(Date.parse(value.asOf))
    || typeof value.stale !== "boolean") {
    return false;
  }
  if (value.reason !== undefined && !FAILURE_REASONS.has(value.reason as YoutubeFailure)) return false;
  return !value.stale || value.reason !== undefined;
}
