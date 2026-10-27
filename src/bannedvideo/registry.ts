import rawSnapshot from "../data/bannedVideoSnapshot.json";
import { validateBannedVideoSnapshot, type SnapshotCheck } from "./validate";

/**
 * The built-in banned.video trending snapshot, checked once at import. Unlike the YouTube registry
 * this does NOT throw: a bad file shows an explicit error inside the BANNED VIDEO tab only, so the
 * other news tabs keep working.
 *
 * To refresh: run the scraper bundle (scrape_and_test.py), then
 *   python tools/bannedvideo-slim.py <channel.json> src/data/bannedVideoSnapshot.json
 */
export const BANNED_VIDEO_SNAPSHOT: SnapshotCheck = validateBannedVideoSnapshot(rawSnapshot);
