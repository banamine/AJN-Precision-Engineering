import assert from "node:assert/strict";
import { LAST_VIEW_KEY, loadLastView, saveLastView, type LastViewStorage } from "./lastView";

function memoryStorage(): LastViewStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

const validDestinations = ["home", "tv-guide", "news"];
const storage = memoryStorage();
assert.equal(loadLastView(validDestinations, storage), null);
const original = {
  version: 1 as const,
  destination: "tv-guide",
  guideId: "cable-tv",
  scrollY: 500,
  scrollX: 1200,
  savedAt: 1000,
};
saveLastView(original, storage);
assert.deepEqual(loadLastView(validDestinations, storage), original);
saveLastView({ destination: "news" }, storage);
assert.deepEqual(loadLastView(validDestinations, storage), { ...original, destination: "news" });
saveLastView({ guideId: "audio-podcasts" }, storage);
assert.deepEqual(loadLastView(validDestinations, storage), {
  ...original, destination: "news", guideId: "audio-podcasts",
});

storage.setItem(LAST_VIEW_KEY, "{broken");
assert.equal(loadLastView(validDestinations, storage), null);
storage.setItem(LAST_VIEW_KEY, JSON.stringify({ ...original, version: 2 }));
assert.equal(loadLastView(validDestinations, storage), null);
storage.setItem(LAST_VIEW_KEY, JSON.stringify({ ...original, destination: "unknown" }));
assert.equal(loadLastView(validDestinations, storage), null);
storage.setItem(LAST_VIEW_KEY, JSON.stringify({ ...original, scrollY: "500" }));
assert.equal(loadLastView(validDestinations, storage), null);

const blocked: LastViewStorage = {
  getItem() { throw new Error("Storage blocked"); },
  setItem() { throw new Error("Storage blocked"); },
};
assert.equal(loadLastView(validDestinations, blocked), null);
assert.doesNotThrow(() => saveLastView({ destination: "home" }, blocked));
const blockedWrite: LastViewStorage = {
  getItem: () => null,
  setItem() { throw new Error("Writes blocked"); },
};
assert.doesNotThrow(() => saveLastView({ destination: "home" }, blockedWrite));

console.log("[last-view] PASS — round trip, merge, missing/corrupt/version/destination/shape guards, and blocked storage");
