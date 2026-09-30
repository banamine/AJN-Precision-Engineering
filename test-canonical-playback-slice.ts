import assert from 'node:assert/strict';
import { parseM3u } from './guideRegistry.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';

const directMp4M3u = `#EXTM3U
#EXTINF:120 tvg-id="demo-mp4" tvg-name="Demo MP4" group-title="TV",Demo MP4
https://media.example.test/demo.mp4
`;

const directEntries = parseM3u(directMp4M3u);
assert.equal(directEntries.length, 1);
assert.deepEqual(directEntries[0], {
  title: 'Demo MP4',
  url: 'https://media.example.test/demo.mp4',
  tvgId: 'demo-mp4',
  tvgName: 'Demo MP4',
  groupTitle: 'TV',
  duration: 120,
});

const archivePath = '/download/demo_identifier/demo-file.mp4?start=0&end=120';
assert.equal(
  buildArchiveProxyUrl(archivePath),
  `/api/archive/proxy?path=${encodeURIComponent(archivePath)}`,
);

// Negative boundary: the real parser drops an EXTINF entry when no URL line follows it.
const noUrlEntries = parseM3u(`#EXTM3U
#EXTINF:60 tvg-id="missing",Missing URL
`);
assert.equal(noUrlEntries.length, 0);

// Negative boundary: the real parser does not enforce an MP4-only URL policy.
// Non-MP4 URLs remain parser output and require a later admission/validation stage.
const nonMp4Entries = parseM3u(`#EXTM3U
#EXTINF:60 tvg-id="hls",HLS Example
https://media.example.test/live.m3u8
`);
assert.equal(nonMp4Entries.length, 1);
assert.equal(nonMp4Entries[0].url, 'https://media.example.test/live.m3u8');

// Production ingestM3uPlaylist was inspected before this test was written.
// It mutates module-level channel/source maps and updates playlist timestamps,
// so it is intentionally not called here. The canonical production boundary
// is documented as parseM3u -> ingestM3uPlaylist -> Channel + ChannelSource.
// This test stays pure and does not share registry state across cases.

console.log('canonical playback slice contract: all passed');