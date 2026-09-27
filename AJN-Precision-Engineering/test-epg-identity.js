import { normalizeAssetIdentity, normalizeChannelIdentity, normalizeProgramIdentity, normalizeSourceIdentity, sanitizeIdentityUrl } from './src/utils/epgIdentity.ts';

function assert(condition, message) { if (!condition) throw new Error(message); }
function eq(actual, expected, message) { assert(actual === expected, `${message}\nExpected: ${expected}\nActual: ${actual}`); }
function throws(fn, message) { let ok = false; try { fn(); } catch { ok = true; } assert(ok, message); }

console.log('EPG identity regression: starting');
const baseUrl = 'https://cdn.example.test/live/channel.m3u8?profile=hd&token=alpha&expires=100';
const rotatedUrl = 'https://cdn.example.test/live/channel.m3u8?profile=hd&token=beta&expires=200';
const differentProfileUrl = 'https://cdn.example.test/live/channel.m3u8?profile=sd&token=beta&expires=200';
eq(sanitizeIdentityUrl(baseUrl), 'https://cdn.example.test/live/channel.m3u8?profile=hd', 'Sanitizer must remove ephemeral but retain meaningful query parameters');
eq(normalizeSourceIdentity({ channelId: 'fox-news', url: baseUrl, protocol: 'https' }), normalizeSourceIdentity({ channelId: 'fox-news', url: rotatedUrl, protocol: 'https' }), 'Rotating auth/expiry values must not change source identity');
assert(normalizeSourceIdentity({ channelId: 'fox-news', url: baseUrl, protocol: 'https' }) !== normalizeSourceIdentity({ channelId: 'fox-news', url: differentProfileUrl, protocol: 'https' }), 'Meaningful query changes must change source identity');
eq(normalizeChannelIdentity({ externalId: 'FOX-NEWS', name: 'Fox News', guideId: 'cable-tv' }), normalizeChannelIdentity({ externalId: 'fox-news', name: 'Other', guideId: 'other' }), 'External channel IDs must dominate descriptive metadata');
eq(normalizeProgramIdentity({ externalId: 'ARCHIVE-123', channelId: 'fox-news', title: 'Hannity', startTime: '2026-09-20T06:00:00Z' }), normalizeProgramIdentity({ externalId: 'ARCHIVE-123', channelId: 'fox-news', title: 'Changed', startTime: '2026-09-20T07:00:00-05:00' }), 'External program IDs must be stable');
eq(normalizeProgramIdentity({ channelId: 'fox-news', title: '  Hannity  ', startTime: '2026-09-20T06:00:00Z' }), normalizeProgramIdentity({ channelId: 'FOX-NEWS', title: 'hannity', startTime: '2026-09-20T01:00:00-05:00' }), 'Equivalent UTC instants/text must normalize identically');
const first = ['A','B','C'].map((id) => normalizeProgramIdentity({ externalId: id, channelId: 'fox-news', title: id, startTime: '2026-09-20T08:00:00Z' }));
const second = ['C','A','B'].map((id) => normalizeProgramIdentity({ externalId: id, channelId: 'fox-news', title: id, startTime: '2026-09-20T08:00:00Z' }));
eq(new Set(first).size, 3, 'Distinct external program IDs must remain distinct');
eq(JSON.stringify([...first].sort()), JSON.stringify([...second].sort()), 'Array reordering must not change program IDs');
throws(() => normalizeProgramIdentity({ channelId: 'fox-news', title: 'Hannity' }), 'Missing externalId and startTime must be rejected');
eq(normalizeAssetIdentity({ archiveIdentifier: 'FOXNEWSW_20260903_060000_Hannity' }), normalizeAssetIdentity({ archiveIdentifier: 'FOXNEWSW_20260903_060000_Hannity', mediaUrl: baseUrl }), 'Archive identifier must dominate transport URL');
console.log('EPG identity regression: PASS');