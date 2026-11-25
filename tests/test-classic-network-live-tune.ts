import assert from 'node:assert/strict';
import { tuneIn, isLiveStream } from '../src/guide/liveTune';
import type { Program } from '../src/types';
const now = Date.parse('2026-11-04T08:10:00Z');
const p: Program = { id: 'fixture', guideId: 'classic-tv', channelId: 'classic-network', title: 'SYNTHETIC',
  mediaType: 'video', mediaUrl: '/fixture.webm', startTime: 0, endTime: 1,
  startTimeUtc: '2026-11-04T08:00:00Z', endTimeUtc: '2026-11-04T09:00:00Z',
  metadata: { epg: 'utc', scheduledVod: true, durationSeconds: 3600 } };
assert.equal(isLiveStream(p), false);
assert.equal(tuneIn(p, 0, 1, 0, now).startAtSeconds, 600);
assert.equal(tuneIn(p, 0, 1, 0, now - 600_000).reason, 'just-started');
assert.equal(tuneIn(p, 0, 1, 0, now + 3600_000).reason, 'ended');
assert.equal(tuneIn(p, 0, 1, 0, now + 3600_000).startAtSeconds, 3600);
assert.equal(tuneIn({ ...p, metadata: { epg: 'utc' } }, 0, 1, 0, now).reason, 'live-stream');
console.log('CLASSIC_NETWORK_LIVE_TUNE_PASS assertions=6');
