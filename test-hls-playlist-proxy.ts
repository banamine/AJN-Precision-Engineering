// Offline regression: Pluto playlist-only proxy rewrite + host allowlist.
import assert from 'node:assert/strict';
import { hlsProxyAllowed, rewritePlaylist } from './server/hlsPlaylistProxy.ts';

assert.ok(hlsProxyAllowed('jmp2.uk'));
assert.ok(hlsProxyAllowed('stitcher-ipv4.pluto.tv'));
assert.ok(!hlsProxyAllowed('evil.com'));
assert.ok(!hlsProxyAllowed('pluto.tv.evil.com'));

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subtitle/subs/en/playlist.m3u8?sid=1"
#EXT-X-STREAM-INF:BANDWIDTH=1539795
1539795/playlist?sid=1&authToken=abc
`;
const m = rewritePlaylist(master, 'https://stitcher-ipv4.pluto.tv/v2/stitch/embed/hls/channel/X/master.m3u8?t=1');
assert.ok(m.includes('URI="/api/hls/playlist?url=https%3A%2F%2Fstitcher-ipv4.pluto.tv%2Fv2%2Fstitch%2Fembed%2Fhls%2Fchannel%2FX%2Fsubtitle'), 'subtitle playlist proxied');
assert.ok(m.includes('/api/hls/playlist?url=https%3A%2F%2Fstitcher-ipv4.pluto.tv%2Fv2%2Fstitch%2Fembed%2Fhls%2Fchannel%2FX%2F1539795%2Fplaylist%3Fsid%3D1%26authToken%3Dabc'), 'variant proxied with token');

const variant = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://mcdn-01.plutotv.net/k/8017.key"
#EXTINF:6.0,
https://mcdn-01.plutotv.net/seg/0001.ts
#EXT-X-DISCONTINUITY
#EXTINF:6.0,
seg2.ts
`;
const v = rewritePlaylist(variant, 'https://stitcher-ipv4.pluto.tv/v2/x/playlist');
assert.ok(v.includes('URI="https://mcdn-01.plutotv.net/k/8017.key"'), 'keys stay direct');
assert.ok(v.includes('\nhttps://mcdn-01.plutotv.net/seg/0001.ts'), 'segments stay direct');
assert.ok(v.includes('\nhttps://stitcher-ipv4.pluto.tv/v2/x/seg2.ts'), 'relative segment made absolute');
assert.ok(v.includes('#EXT-X-DISCONTINUITY'), 'tags preserved');
console.log('hls playlist proxy regression: all passed');
