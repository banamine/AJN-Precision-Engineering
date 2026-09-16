import assert from "node:assert/strict";
import test from "node:test";
import { toAjnMediaRecords, AJN_CATEGORY_DESTINATIONS } from "./ajn-program-catalog";
import type { Program } from "../types";

test("maps existing programs without replacing the playback contract", () => {
  const programs: Program[] = [
    {
      id: "p1",
      guideId: "cable-tv",
      channelId: "classic-tv",
      title: "Classic Episode",
      startTime: Date.parse("2026-09-15T12:00:00Z"),
      endTime: Date.parse("2026-09-15T13:00:00Z"),
      mediaType: "video",
      mediaUrl: "",
      archivePath: "/download/example/classic.mp4",
      metadata: { category: "Classic TV" },
    },
  ];

  const [record] = toAjnMediaRecords(programs);
  assert.equal(record.id, "p1");
  assert.equal(record.playbackUrl, "/download/example/classic.mp4");
  assert.equal(record.playable, true);
  assert.equal(record.visualAssetKey, "classic-archive");
});

test("exposes the six curated category destinations", () => {
  assert.equal(AJN_CATEGORY_DESTINATIONS.length, 6);
  assert.deepEqual(
    AJN_CATEGORY_DESTINATIONS.map((item) => item.key),
    [
      "alex-jones-show",
      "war-room",
      "special-coverage",
      "special-report",
      "emergency-broadcast",
      "classic-archive",
    ],
  );
});
