import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanArchiveMusicFilename } from "./src/utils/archiveMusicTitle";
import { isArchiveMusicPlayback } from "./src/utils/isArchiveMusicPlayback";

type JsonRecord = Record<string, unknown>;

function readJson(path: string): JsonRecord {
  const value: unknown = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must contain an object`);
  return value as JsonRecord;
}

const examples = [
  {
    input: "053. Fancy Ft. Sabrina - X.mp3",
    expected: {
      title: "X",
      artist: "Fancy Ft. Sabrina",
      rawFilename: "053. Fancy Ft. Sabrina - X.mp3",
    },
  },
  {
    input: "artist_-_title.flac",
    expected: {
      title: "title",
      artist: "artist",
      rawFilename: "artist_-_title.flac",
    },
  },
  {
    input: "/download/collection/053. Coldplay - Viva_La_Vida.mp3",
    expected: {
      title: "Viva La Vida",
      artist: "Coldplay",
      rawFilename: "053. Coldplay - Viva_La_Vida.mp3",
    },
  },
  {
    input: "/download/collection/02_James_Blunt_-_Youre_Beautiful.flac",
    expected: {
      title: "Youre Beautiful",
      artist: "James Blunt",
      rawFilename: "02_James_Blunt_-_Youre_Beautiful.flac",
    },
  },
  {
    input: "/api/archive/proxy?path=%2Fdownload%2Fcollection%2F001.%2520The%2520Band%2520-%2520Song.mp3",
    expected: {
      title: "Song",
      artist: "The Band",
      rawFilename: "001. The Band - Song.mp3",
    },
  },
];

for (const { input, expected } of examples) {
  assert.deepEqual(cleanArchiveMusicFilename(input), expected);
}

assert.deepEqual(cleanArchiveMusicFilename("single_track.ogg"), {
  title: "single track",
  artist: "",
  rawFilename: "single_track.ogg",
});
assert.deepEqual(cleanArchiveMusicFilename("plain title"), {
  title: "plain title",
  artist: "",
  rawFilename: "plain title",
});
assert.deepEqual(cleanArchiveMusicFilename(""), { title: "", artist: "", rawFilename: "" });
assert.equal(isArchiveMusicPlayback("audio", "item-music-x"), true);
assert.equal(isArchiveMusicPlayback("audio", "music-america-4th-of-july-1978-universal-amphitheatre-kwst"), true);
assert.equal(isArchiveMusicPlayback("video", "item-music-x"), false);
assert.equal(isArchiveMusicPlayback("video", "music-america-4th-of-july-1978-universal-amphitheatre-kwst"), false);
assert.equal(isArchiveMusicPlayback("video", "music-america-4th-of-july-1978-universal-amphitheatre-kwst"), false);

// Every live-radio channel ID accepted by the shipped station registries must
// remain outside the Archive-only layout. RadioBriefingPlayerOverlay reuses
// these same station IDs; it has no separate channel-ID namespace.
const liveRadioFiles = [
  "./src/data/liveRadioSources.json",
  "./server/data/liveRadioDirectory.json",
  "./server/data/liveRadioVancouver.json",
  "./server/data/liveRadioClassicHits109.json",
];
const liveRadioIds = new Set<string>();
for (const path of liveRadioFiles) {
  const source = readJson(path);
  const stations = Array.isArray(source.stations) ? source.stations : [];
  for (const station of stations) {
    if (station !== null && typeof station === "object" && "id" in station && typeof station.id === "string") {
      liveRadioIds.add(station.id);
    }
  }
}
const numberRegistry = readJson("./server/data/liveRadioNumbers.json").numbers;
if (numberRegistry !== null && typeof numberRegistry === "object") {
  for (const id of Object.keys(numberRegistry)) liveRadioIds.add(id);
}
for (const id of Object.keys(readJson("./server/data/nowPlayingStations.json"))) {
  liveRadioIds.add(id);
}
assert.equal(liveRadioIds.size, 2303, "live-radio source set changed; review namespace coverage");
for (const channelId of liveRadioIds) {
  assert.ok(channelId.startsWith("radio:"), `unexpected live-radio channel ID: ${channelId}`);
  assert.equal(isArchiveMusicPlayback("audio", channelId), false, `live-radio channel matched Archive mode: ${channelId}`);
}

// Podcast channel IDs are derived as `pod-${source.id}` by server/podcasts.ts.
const podcastSourceRows = readJson("./src/data/podcastSources.json").sources;
const podcastSources = Array.isArray(podcastSourceRows) ? podcastSourceRows : [];
const podcastChannelIds = podcastSources.flatMap((source) => {
  if (source !== null && typeof source === "object" && "id" in source && typeof source.id === "string") {
    return [`pod-${source.id}`];
  }
  return [];
});
for (const channelId of podcastChannelIds) {
  assert.equal(isArchiveMusicPlayback("audio", channelId), false, `podcast channel matched Archive mode: ${channelId}`);
}
for (const channelId of ["ajn-radio", "ajn-exclusive"]) {
  assert.equal(isArchiveMusicPlayback("audio", channelId), false);
}

console.log(`Archive music title and mode tests passed; ${liveRadioIds.size} live-radio and ${podcastChannelIds.length} podcast IDs excluded.`);
