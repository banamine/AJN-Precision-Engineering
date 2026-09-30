import assert from "node:assert/strict";
import {
  DEFAULT_MULTIVIEW_ADMISSION_POLICY,
  evaluateMultiViewAdmission,
} from "./src/multiview/admission";
import {
  DEFAULT_MULTIVIEW_STATE,
  setAudioTile,
  setFocusedTile,
  setLayout,
} from "./src/multiview/state";
import type { MultiViewTile } from "./src/multiview/types";

const tile = (
  id: MultiViewTile["id"],
  type: NonNullable<MultiViewTile["source"]>["type"],
  url = `https://example.test/${id}`,
): MultiViewTile => ({
  id,
  enabled: true,
  source: { type, url },
});

const tiles: MultiViewTile[] = [
  tile("tile-0", "mp4"),
  tile("tile-1", "mp4"),
  tile("tile-2", "mp4"),
  tile("tile-3", "iframe"),
];

assert.deepEqual(DEFAULT_MULTIVIEW_STATE, {
  layout: "2x2",
  focusedTile: "tile-0",
  audioTile: null,
});

const focused = setFocusedTile(DEFAULT_MULTIVIEW_STATE, "tile-2");
assert.equal(focused.focusedTile, "tile-2");

const changedLayout = setLayout(focused, "2x1");
assert.equal(changedLayout.layout, "2x1");

const audioOne = setAudioTile(changedLayout, "tile-1");
assert.equal(audioOne.audioTile, "tile-1");
const audioTwo = setAudioTile(audioOne, "tile-3");
assert.equal(audioTwo.audioTile, "tile-3");
assert.notEqual(audioTwo.audioTile, audioOne.audioTile);

const admissions = evaluateMultiViewAdmission(
  tiles,
  "tile-2",
  DEFAULT_MULTIVIEW_ADMISSION_POLICY,
);

assert.deepEqual(admissions, [
  { tileId: "tile-0", status: "admitted" },
  { tileId: "tile-1", status: "poster_standby", reason: "video_limit" },
  { tileId: "tile-2", status: "admitted" },
  { tileId: "tile-3", status: "admitted" },
]);

const iframeLimited = evaluateMultiViewAdmission(
  [
    tile("tile-0", "iframe"),
    tile("tile-1", "iframe"),
    tile("tile-2", "audio"),
    tile("tile-3", "audio"),
  ],
  "tile-0",
  { maxConcurrentVideoElements: 2, maxIframes: 1 },
);

assert.equal(iframeLimited.find((x) => x.tileId === "tile-0")?.status, "admitted");
assert.deepEqual(iframeLimited.find((x) => x.tileId === "tile-1"), {
  tileId: "tile-1",
  status: "poster_standby",
  reason: "iframe_limit",
});
assert.equal(iframeLimited.find((x) => x.tileId === "tile-2")?.status, "admitted");
assert.equal(iframeLimited.find((x) => x.tileId === "tile-3")?.status, "admitted");

const focusedPriority = evaluateMultiViewAdmission(
  tiles,
  "tile-2",
  { maxConcurrentVideoElements: 1, maxIframes: 1 },
);
assert.equal(
  focusedPriority.find((x) => x.tileId === "tile-2")?.status,
  "admitted",
);
assert.equal(
  focusedPriority.find((x) => x.tileId === "tile-0")?.status,
  "poster_standby",
);

const explicitEmpty = evaluateMultiViewAdmission(
  [tile("tile-0", "mp4")],
  "tile-0",
);
assert.deepEqual(explicitEmpty.find((x) => x.tileId === "tile-1"), {
  tileId: "tile-1",
  status: "empty",
  reason: "empty",
});

console.log("[multiview-contract] PASS: tile model, runtime state, single-audio rule, and admission policy.");
console.log("[multiview-contract] PASS: over-limit video/iframe tiles become poster_standby.");
