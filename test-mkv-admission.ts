import assert from 'node:assert';
import { setMockVerifiedData, mkvVerdict } from './server/sources/mkvVerified';
import { notWebPlayableVideo } from './server/sources/archiveLinks';

// Tests the REAL admission function used by guides (not a copy of its logic).
const testNotWebPlayableVideo = notWebPlayableVideo;

console.log('Running test-mkv-admission.ts...');

const verifiedPath = '/download/sisters1991/Sisters - S01E01 - Moving In, Moving Out, Moving On.mkv';
const hevcPath = '/download/2015-music.-7z/The Addams Family/S01E01.mkv';

setMockVerifiedData({
  [verifiedPath]: {
    status: 'verified',
    browserPlayable: true,
    hasCues: true,
    videoNorm: 'h264',
    audioNorm: 'aac',
    videoCodec: 'V_MPEG4/ISO/AVC',
    audioCodec: 'A_AAC',
  },
  [hevcPath]: {
    status: 'verified',
    browserPlayable: false,
    hasCues: true,
    videoNorm: 'hevc',
    audioNorm: 'aac',
    videoCodec: 'V_MPEGH/ISO/HEVC',
    audioCodec: 'A_AAC',
    reason: 'unplayable codec: video=hevc',
  },
});

// 1. Verified MKV -> null
assert.strictEqual(
  testNotWebPlayableVideo(verifiedPath),
  null,
  'verified mkv must return null (playable)'
);

// 2. HEVC MKV -> ".mkv rejected: ..."
const hevcVerdict = testNotWebPlayableVideo(hevcPath);
assert(
  hevcVerdict?.startsWith('.mkv rejected:'),
  `hevc mkv must return rejected reason, got: ${hevcVerdict}`
);

// 3. Unknown MKV -> ".mkv not yet codec-verified"
assert.strictEqual(
  testNotWebPlayableVideo('/download/unknown/video.mkv'),
  '.mkv not yet codec-verified'
);

// 4. .mp4 -> null
assert.strictEqual(
  testNotWebPlayableVideo('/download/item/video.mp4'),
  null,
  '.mp4 must return null'
);

// 5. .avi -> ".avi is not browser-playable"
assert.strictEqual(
  testNotWebPlayableVideo('/download/item/video.avi'),
  '.avi is not browser-playable'
);

// 6. Proxy URL and %20-encoded forms of the verified path -> null
const encodedPath = '/download/sisters1991/Sisters%20-%20S01E01%20-%20Moving%20In%2C%20Moving%20Out%2C%20Moving%20On.mkv';
assert.strictEqual(
  testNotWebPlayableVideo(encodedPath),
  null,
  '%20-encoded form of verified path must return null'
);

const proxyUrl = `/api/archive/proxy?path=${encodeURIComponent(encodedPath)}`;
assert.strictEqual(
  testNotWebPlayableVideo(proxyUrl),
  null,
  'proxy URL of verified path must return null'
);

const fullArchiveUrl = `https://archive.org${encodedPath}`;
assert.strictEqual(
  testNotWebPlayableVideo(fullArchiveUrl),
  null,
  'full https://archive.org URL of verified path must return null'
);

// Clean up mock
setMockVerifiedData(null);

console.log('All test-mkv-admission tests PASSED!');
