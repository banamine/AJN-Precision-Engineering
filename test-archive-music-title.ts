import assert from "node:assert/strict";
import { cleanArchiveMusicFilename } from "./src/utils/archiveMusicTitle";
import { isArchiveMusicPlayback } from "./src/utils/isArchiveMusicPlayback";

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
assert.equal(isArchiveMusicPlayback("audio", "item-music-00s-radio-hits-2024"), true);
assert.equal(isArchiveMusicPlayback("video", "item-music-00s-radio-hits-2024"), false);
assert.equal(isArchiveMusicPlayback("audio", "radio:ch109-original"), false);

console.log("Archive music title and mode tests passed.");
