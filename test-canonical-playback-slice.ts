// Contract test for the canonical playback slice as it exists in the repo.
// See AJN_CANONICAL_PLAYBACK_SLICE.md. Offline: no network, no server, no source-text checks.
//
// Boundaries covered here that no other test composes:
//   A. Programs held by the registry (Nova + Movies & Classics producers) carry a
//      proxied direct-MP4 mediaUrl that decodes back to the canonical /download/ path.
//   B. That mediaUrl is same-origin, so the audio bridge admits it (corsModeFor).
//   C. The production M3U path (guideRegistry.ingestM3uPlaylist) yields Channel +
//      ChannelSource records and one canonical Program per entry.
// Proxy range slicing stays in test-proxy-range.ts; classicM3uContract stays in
// test-source-contracts.ts.
import assert from 'node:assert/strict';
import {
  getCanonicalPrograms,
  parseM3u,
  ingestM3uPlaylist,
  getChannelById,
  getChannelSources,
} from './guideRegistry.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';
import { bridgeSrc, corsModeFor } from './src/utils/mediaRoute.ts';
import type { Playlist } from './src/types.ts';

const PROXY_PREFIX = '/api/archive/proxy?path=';

// ── A. Registry programs: direct MP4 through the proxy contract ─────────────
const archivePrograms = getCanonicalPrograms().filter((p) => p.sourceClass === 'archive_org');
assert.ok(archivePrograms.length > 0, 'registry must hold at least one archive_org program');

for (const p of archivePrograms) {
  assert.ok(p.id && p.assetId && p.sourceId, `program ${p.title} must carry id, assetId and sourceId`);
  assert.ok(p.mediaUrl.startsWith(PROXY_PREFIX), `mediaUrl must go through the proxy: ${p.mediaUrl}`);
  const decoded = decodeURIComponent(p.mediaUrl.slice(PROXY_PREFIX.length));
  assert.ok(decoded.startsWith('/download/'), `proxy path must be a canonical /download/ path: ${decoded}`);
  assert.ok(!/^https?:/i.test(decoded), 'proxy path must not be an absolute URL (no SSRF surface)');
  assert.equal(p.mediaUrl, buildArchiveProxyUrl(decoded), `mediaUrl must round-trip through buildArchiveProxyUrl: ${p.title}`);
  if (p.archivePath) assert.equal(decoded, p.archivePath, `archivePath and mediaUrl must agree: ${p.title}`);
}
assert.ok(archivePrograms.some((p) => /\.mp4(\?|$)/i.test(decodeURIComponent(p.mediaUrl))), 'at least one program must be a direct MP4');

// ── B. Same-origin proxy URL is admitted by the audio bridge ────────────────
const sample = archivePrograms[0];
assert.equal(bridgeSrc(sample.mediaUrl), sample.mediaUrl, 'proxy URL must not be rewritten by bridgeSrc');
assert.equal(corsModeFor(sample.mediaUrl, false), 'anonymous', 'same-origin proxy URL must be CORS-anonymous so the bridge can read it');

// ── C. Production M3U path: Channel + ChannelSource + canonical Program ──
const before = getCanonicalPrograms().length;
const fixture = `#EXTM3U
#EXTINF:1500 tvg-id="slice-test" group-title="Slice Test",Slice Test Show
https://archive.org/download/slice-test/episode-01.mp4
#EXTINF:60,No URL follows this line
#EXTINF:60,Second entry
https://example.org/live/stream.m3u8
#EXTINF:60,
https://example.org/untitled.mp4
`;
const entries = parseM3u(fixture);
assert.deepEqual(entries.map((e) => e.title), ['Slice Test Show', 'Second entry'], 'entries without a title or without a URL are dropped');

const playlist: Playlist = {
  id: 'slice-test-playlist', name: 'Slice Test', sourceUrl: 'test://fixture', category: 'TV Shows',
  enabled: true, lastSyncedAt: '', syncStatus: 'pending',
};
const result = ingestM3uPlaylist(playlist, fixture, 'cable-tv');
assert.equal(result.ingestedCount, 2);

const channel = getChannelById('channel-slice-test');
assert.ok(channel, 'tvg-id must become the channel identity');
assert.equal(channel!.guideId, 'cable-tv');
const sources = getChannelSources('channel-slice-test');
assert.equal(sources.length, 1);
assert.equal(sources[0].url, 'https://archive.org/download/slice-test/episode-01.mp4');
assert.equal(sources[0].protocol, 'https');
assert.ok(result.channels.some((c) => getChannelSources(c.id).some((s) => s.protocol === 'hls')), '.m3u8 entry must be classified hls');

// M3U ingestion registers one canonical Program per ingested entry, tied to its ChannelSource.
// (Formerly a pinned KNOWN GAP; closed by the M3U Program ingestion repair.)
const added = getCanonicalPrograms().slice(before);
assert.equal(added.length, 2, 'each ingested M3U entry must register exactly one canonical Program');
for (const program of added) {
  assert.ok(program.id && program.assetId && program.sourceId, `M3U Program ${program.title} must carry id, assetId and sourceId`);
  assert.equal(program.guideId, 'cable-tv');
  const channelSources = getChannelSources(program.channelId);
  assert.ok(channelSources.some((s) => s.id === program.sourceId), 'Program.sourceId must match its ChannelSource id');
  assert.ok(channelSources.some((s) => s.url === program.mediaUrl), 'Program.mediaUrl must be the entry URL');
}
ingestM3uPlaylist(playlist, fixture, 'cable-tv');
assert.equal(getCanonicalPrograms().length, before + 2, 're-ingesting the same playlist must not duplicate Programs');

console.log('canonical playback slice contract: all passed');
