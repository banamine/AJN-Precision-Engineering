import assert from "node:assert/strict";
import type { ScheduleChannel } from "../types";
import {
  clearScheduleCache,
  getCachedSchedule,
  isStale,
  setCachedSchedule,
  STALE_AFTER_MS,
} from "./scheduleCache";

const channels = [{ id: "test-channel", name: "Test channel", programs: [] }] as ScheduleChannel[];
const otherChannels = [{ id: "other-channel", name: "Other channel", programs: [] }] as ScheduleChannel[];
const fetchedAt = 1000;

clearScheduleCache();
assert.equal(getCachedSchedule("first"), undefined);
setCachedSchedule("first", channels, fetchedAt);
assert.deepEqual(getCachedSchedule("first"), { channels, fetchedAt });
assert.equal(isStale(getCachedSchedule("first")!, fetchedAt + STALE_AFTER_MS - 1), false);
assert.equal(isStale(getCachedSchedule("first")!, fetchedAt + STALE_AFTER_MS), true);
assert.equal(isStale(getCachedSchedule("first")!, fetchedAt + STALE_AFTER_MS + 1), true);

setCachedSchedule("empty", [], fetchedAt);
assert.equal(getCachedSchedule("empty"), undefined);
for (const invalid of [null, undefined, {}, "channels", 42]) {
  setCachedSchedule("invalid", invalid, fetchedAt);
  assert.equal(getCachedSchedule("invalid"), undefined);
}
setCachedSchedule("first", [], fetchedAt + 1);
setCachedSchedule("first", null, fetchedAt + 2);
assert.deepEqual(getCachedSchedule("first"), { channels, fetchedAt }, "invalid refreshes preserve a good entry");

setCachedSchedule("second", otherChannels, fetchedAt + 10);
assert.equal(getCachedSchedule("first")?.channels, channels);
assert.equal(getCachedSchedule("second")?.channels, otherChannels);
clearScheduleCache("first");
assert.equal(getCachedSchedule("first"), undefined);
assert.ok(getCachedSchedule("second"));
clearScheduleCache();
assert.equal(getCachedSchedule("second"), undefined);

console.log("[schedule-cache] PASS — stores, rejects empty/non-array results, freshness, independent guides, and clear one/all");
