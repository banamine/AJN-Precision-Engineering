import { ingestM3uPlaylist, getChannelSources, getChannelsByGuide, parseM3u } from './guideRegistry.ts';

function assert(condition, message) { if (!condition) throw new Error(message); }
function eq(actual, expected, message) { assert(actual === expected, `${message}\nExpected: ${expected}\nActual: ${actual}`); }

console.log('EPG identity producer regression: starting');

const playlist = { id: 'test-producer-wiring', name: 'Producer Wiring Regression', sourceUrl: 'https://example.test/playlist.m3u', category: 'News', enabled: true, lastSyncedAt: new Date(0).toISOString(), syncStatus: 'pending' };

const m3uA = `#EXTM3U
#EXTINF:-1 tvg-id="producer-fox" tvg-name="Fox News" tvg-logo="https://example.test/logo.png" group-title="News",Fox News
https://cdn.example.test/live/producer-fox.m3u8?profile=hd&token=alpha&expires=100
#EXTINF:-1 tvg-id="producer-cnn" tvg-name="CNN" group-title="News",CNN
https://cdn.example.test/live/producer-cnn.m3u8?token=alpha&expires=100`;

const m3uB = `#EXTM3U
#EXTINF:-1 tvg-id="producer-cnn" tvg-name="CNN" group-title="News",CNN
https://cdn.example.test/live/producer-cnn.m3u8?token=beta&expires=200
#EXTINF:-1 tvg-id="producer-fox" tvg-name="Fox News" tvg-logo="https://example.test/logo.png" group-title="News",Fox News
https://cdn.example.test/live/producer-fox.m3u8?profile=hd&token=beta&expires=200`;

const parsed = parseM3u(m3uA);
eq(parsed.length, 2, 'M3U parser should retain both entries');
eq(parsed[0].tvgLogo, 'https://example.test/logo.png', 'tvgLogo should parse');
eq(parsed[0].groupTitle, 'News', 'groupTitle should parse');

const first = ingestM3uPlaylist(playlist, m3uA);
const firstChannelIds = first.channels.map((channel) => channel.id).sort();
const firstSourceIds = firstChannelIds.flatMap((id) => getChannelSources(id).map((source) => source.id)).sort();

const second = ingestM3uPlaylist(playlist, m3uB);
const secondChannelIds = second.channels.map((channel) => channel.id).sort();
const secondSourceIds = secondChannelIds.flatMap((id) => getChannelSources(id).map((source) => source.id)).sort();

eq(firstChannelIds.join('|'), secondChannelIds.join('|'), 'Reordered M3U entries and rotated auth tokens must preserve channel identities');
eq(firstSourceIds.join('|'), secondSourceIds.join('|'), 'Reordered M3U entries and rotated auth tokens must preserve source identities');
eq(new Set(secondSourceIds).size, secondSourceIds.length, 'Repeated playlist ingestion must not duplicate canonical sources');

const fox = second.channels.find((channel) => channel.tvgId === 'producer-fox');
assert(fox, 'Fox producer channel should remain addressable by tvg-id metadata');
eq(fox?.logo, 'https://example.test/logo.png', 'M3U tvgLogo should be retained');
eq(fox?.group, 'News', 'M3U groupTitle should be retained');

const distinct = `#EXTM3U
#EXTINF:-1 tvg-id="producer-fox" tvg-name="Fox News" group-title="News",Fox News
https://cdn.example.test/live/producer-fox.m3u8?profile=hd
#EXTINF:-1 tvg-id="producer-fox" tvg-name="Fox News" group-title="News",Fox News
https://cdn.example.test/live/producer-fox-backup.m3u8?profile=hd`;
const distinctResult = ingestM3uPlaylist(playlist, distinct);
const foxSources = distinctResult.channels.filter((channel) => channel.tvgId === 'producer-fox').flatMap((channel) => getChannelSources(channel.id));
assert(new Set(foxSources.map((source) => source.id)).size >= 2, 'Distinct stream URLs must produce distinct canonical source IDs');

console.log('EPG identity producer regression: PASS');