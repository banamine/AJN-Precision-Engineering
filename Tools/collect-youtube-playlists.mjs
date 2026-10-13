#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) {
  console.log("[youtube-collector] YOUTUBE_API_KEY is not set; the partial seed was left unchanged.");
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const registryPath = path.join(projectDirectory, "src/data/youtubeChannels.json");
const catalogPath = path.join(projectDirectory, "src/data/youtubePlaylists.json");
const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 100;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLimitedJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
    throw new Error("The Data API response exceeded the size limit.");
  }
  if (!response.body) throw new Error("The Data API response had no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_API_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The Data API response exceeded the size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

async function collect() {
  const { register } = await import("tsx/esm/api");
  register();
  const { isAllowedYoutubeUrl, isYoutubePlaylistId, validateYoutubePlaylistCatalog } = await import("../src/youtube/validate.ts");

  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const channel = registry.channels.find((entry) => (
    entry.id === "yt-filmrise-television"
    && entry.main === true
    && entry.channelId === "UCVVXDVee0JZ2dlPYtpdTZVg"
  ));
  if (!channel) throw new Error("The FilmRise main channel is missing from the registry.");

  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const catalogChannel = catalog.channels.find((entry) => (
    entry.registryId === channel.id && entry.channelId === channel.channelId
  ));
  if (!catalogChannel) throw new Error("The FilmRise playlist seed is missing.");

  const playlists = [];
  const seen = new Set();
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("channelId", channel.channelId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    let payload;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`The Data API returned HTTP ${response.status}.`);
      payload = await readLimitedJson(response);
    } finally {
      clearTimeout(timeout);
    }
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error("The Data API response shape was invalid.");
    }

    for (const item of payload.items) {
      if (!isRecord(item) || !isRecord(item.snippet) || !isRecord(item.snippet.thumbnails)) {
        throw new Error("The Data API returned an invalid playlist item.");
      }
      const thumbnail = item.snippet.thumbnails.medium
        ?? item.snippet.thumbnails.high
        ?? item.snippet.thumbnails.default;
      if (!isYoutubePlaylistId(item.id)
        || typeof item.snippet.title !== "string"
        || !item.snippet.title.trim()
        || item.snippet.title.length > 300
        || !isRecord(thumbnail)
        || typeof thumbnail.url !== "string"
        || !isAllowedYoutubeUrl(thumbnail.url)
        || new URL(thumbnail.url).hostname !== "i.ytimg.com") {
        throw new Error("The Data API returned invalid playlist metadata.");
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      playlists.push({
        id: item.id,
        title: item.snippet.title.trim(),
        thumbnailUrl: thumbnail.url,
        verifiedAt: new Date().toISOString().slice(0, 10),
      });
    }

    if (typeof payload.nextPageToken !== "string" || payload.nextPageToken === "") {
      pageToken = "";
      break;
    }
    pageToken = payload.nextPageToken;
    if (page === MAX_PAGES - 1) throw new Error("The Data API exceeded the page limit.");
  }

  const updated = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    note: "Collected from YouTube Data API; all available playlist pages were fetched.",
    channels: catalog.channels.map((entry) => entry.registryId === channel.id
      ? { ...entry, completeness: "complete", playlists }
      : entry),
  };
  if (!validateYoutubePlaylistCatalog(updated)) {
    throw new Error("The collected playlist catalog failed validation.");
  }
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, catalogPath);
  console.log(`[youtube-collector] Wrote ${playlists.length} FilmRise playlists; catalog validation passed.`);
}

try {
  await collect();
} catch {
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  console.error("[youtube-collector] Collection failed; no API key or upstream response was logged.");
  process.exitCode = 1;
}
