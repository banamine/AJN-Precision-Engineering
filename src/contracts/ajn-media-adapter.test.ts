import assert from "node:assert/strict";
import test from "node:test";
import { defaultAjnPresentationAdapter } from "./ajn-media-adapter";
import { defaultAjnPlaybackController } from "./ajn-playback-controller";
import type { Program } from "../types";

test("adapts an Archive video program without changing its source", () => {
  const program: Program = {
    id: "program-1",
    guideId: "cable-tv",
    channelId: "classic-tv",
    title: "Classic Episode",
    startTime: 0,
    endTime: 3600,
    mediaType: "video",
    mediaUrl: "https://archive.org/download/example/file.mp4",
    archivePath: "/download/example/file.mp4",
  };

  const record = defaultAjnPresentationAdapter.fromProgram(program);

  assert.equal(record.playbackUrl, program.mediaUrl);
  assert.equal(record.archivePath, program.archivePath);
  assert.equal(record.mediaType, "video");
  assert.equal(record.sourceFamily, "archive");
  assert.equal(record.sourceKind, "archive-video");
  assert.equal(record.sourceAuthority, "archive.org");
  assert.equal(record.playable, true);

  const request = defaultAjnPlaybackController.toPlaybackRequest(record);
  assert.deepEqual(request, {
    src: program.mediaUrl,
    mediaType: "video",
    title: program.title,
    programId: program.id,
    archivePath: program.archivePath,
  });
});

test("accepts known direct media URLs as playback sources", () => {
  const program: Program = {
    id: "program-2",
    guideId: "cable-tv",
    channelId: "live",
    title: "Live Channel",
    startTime: 0,
    endTime: 3600,
    mediaType: "video",
    mediaUrl: "https://example.com/live.m3u8",
  };

  const record = defaultAjnPresentationAdapter.fromProgram(program);

  assert.equal(record.playable, true);
  assert.equal(record.playbackUrl, program.mediaUrl);
  assert.equal(record.sourceFamily, "live");
  assert.equal(record.sourceKind, "live-video");
});

test("does not invent playback for an empty source", () => {
  const program: Program = {
    id: "program-3",
    guideId: "cable-tv",
    channelId: "classic-tv",
    title: "Browse Only",
    startTime: 0,
    endTime: 3600,
    mediaType: "video",
    mediaUrl: "",
  };

  const record = defaultAjnPresentationAdapter.fromProgram(program);

  assert.equal(record.playable, false);
  assert.equal(record.playbackUrl, null);
  assert.equal(defaultAjnPlaybackController.toPlaybackRequest(record), null);
});

test("does not treat arbitrary title text as playback media", () => {
  const program: Program = {
    id: "program-4",
    guideId: "cable-tv",
    channelId: "classic-tv",
    title: "Browse Only",
    startTime: 0,
    endTime: 3600,
    mediaType: "video",
    mediaUrl: "Classic Episode",
  };

  const record = defaultAjnPresentationAdapter.fromProgram(program);

  assert.equal(record.playable, false);
  assert.equal(record.playbackUrl, null);
  assert.equal(record.sourceFamily, "unknown");
});

test("does not treat an image asset URL as playback media", () => {
  const program: Program = {
    id: "program-5",
    guideId: "cable-tv",
    channelId: "classic-tv",
    title: "Classic Archive",
    startTime: 0,
    endTime: 3600,
    mediaType: "video",
    mediaUrl: "https://archive.org/download/daily-highlights/Classic%20Archive.png",
  };

  const record = defaultAjnPresentationAdapter.fromProgram(program);

  assert.equal(record.playable, false);
  assert.equal(record.playbackUrl, null);
});
