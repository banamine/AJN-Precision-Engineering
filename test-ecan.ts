import assert from 'node:assert/strict';
import { aqhiRisk, aqhiUrl, ecApplicable, ecSeverity, ecWarningsUrl, parseAqhi, parseEcWarnings } from './src/utils/ecan';

const T = (s: string) => ({ en: s, fr: s });
const city = (name: string, lon: number, lat: number, warnings: unknown[]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: T(name), warnings } });
const w = (type: string, description: string, expiry: string, url = 'https://weather.gc.ca/warnings/report_e.html?on1#abc') => ({ type: T(type), description: T(description), eventIssue: T('2026-11-16T21:30:28Z'), expiryTime: T(expiry), url: T(url) });
const now = Date.parse('2026-11-16T22:00:00Z'); const toronto = { latitude: 43.6532, longitude: -79.3832 };

const json = { features: [
  city('Vaughan', -79.54, 43.85, [w('warning', 'RED WARNING - TORNADO', '2026-11-17T10:00:00Z')]),
  city('Toronto', -79.38, 43.65, [
    w('statement', 'SPECIAL WEATHER STATEMENT', '2026-11-17T13:30:28Z'), w('warning', 'YELLOW WARNING - SNOWFALL', '2026-11-17T09:00:00Z'),
    w('ended', 'YELLOW ADVISORY - FREEZING DRIZZLE ENDED', '2026-11-16T20:00:00Z'), w('warning', 'ORANGE WARNING - FREEZING RAIN', '2026-11-16T10:00:00Z'), w('watch', 'RAINFALL WATCH', '2026-11-17T09:00:00Z', 'http://insecure.example/x')]),
] };
const r = parseEcWarnings(json, toronto, now)!;
assert.equal(r.place, 'Toronto', 'the nearest forecast point is used, not Vaughan');
assert.deepEqual(r.alerts.map((a) => a.event), ['YELLOW WARNING - SNOWFALL', 'RAINFALL WATCH', 'SPECIAL WEATHER STATEMENT'], 'ended and expired notices are dropped; most severe first');
assert.deepEqual(r.alerts.map((a) => a.severity), ['Moderate', 'Moderate', 'Minor']); assert.equal(r.alerts[0].sender, 'Environment Canada'); assert.equal(r.alerts[0].area, 'Issued for Toronto');
assert.equal(r.alerts[0].url, 'https://weather.gc.ca/warnings/report_e.html?on1#abc'); assert.equal(r.alerts[1].url, null, 'only https links are kept'); assert.equal(r.alerts[0].headline, '', 'wording is never rewritten');
assert.deepEqual(parseEcWarnings({ features: [city('Toronto', -79.38, 43.65, [])] }, toronto, now), { place: 'Toronto', alerts: [] }, 'no warnings = empty list');
assert.deepEqual(parseEcWarnings({ features: [] }, toronto, now), { place: null, alerts: [] }, 'nothing nearby = not covered');
assert.equal(parseEcWarnings({ features: [city('Far', -100, 50, [])] }, toronto, now)!.place, null, 'a forecast point 1000 miles away is not "nearby"');
assert.equal(parseEcWarnings({}, toronto, now), null); assert.equal(parseEcWarnings(null, toronto, now), null); assert.equal(parseEcWarnings({ features: [city('X', -79.38, 43.65, [{ type: T('warning') }])] }, toronto, now), null, 'malformed warning = error, never "all clear"');
assert.equal(parseEcWarnings({ features: [{ geometry: { type: 'Polygon', coordinates: [] }, properties: {} }] }, toronto, now)!.place, null);
assert.equal(ecSeverity('warning', 'RED WARNING - X'), 'Extreme'); assert.equal(ecSeverity('warning', 'ORANGE WARNING - X'), 'Severe'); assert.equal(ecSeverity('warning', 'YELLOW WARNING - X'), 'Moderate'); assert.equal(ecSeverity('statement', 'S'), 'Minor'); assert.equal(ecSeverity('mystery', 'S'), 'Unknown');
assert.equal(ecApplicable({ country: 'Canada' }), true); assert.equal(ecApplicable({ country: '' }), true); assert.equal(ecApplicable({ country: 'United States' }), false);
const u = ecWarningsUrl(toronto); assert.ok(u.startsWith('https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=10&bbox=') && !u.includes(' ')); assert.ok(aqhiUrl(toronto).includes('latest=true'), 'history is excluded');
const nums = u.split('bbox=')[1].split(',').map(Number); assert.ok(nums[2] - nums[0] < 1.5 && nums[3] - nums[1] < 1.5, 'a small search box, never the whole collection');

// --- AQHI
const aq = (name: string, lon: number, lat: number, v: unknown, t = '2026-11-17T01:00:00Z') => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { location_name_en: name, aqhi: v, observation_datetime: t, latest: true } });
const a = parseAqhi({ features: [aq('Toronto East', -79.23, 43.76, 2.09), aq('Toronto Downtown', -79.397, 43.676, 2.47), aq('Hamilton', -79.935, 43.24, 9)] }, toronto)!.station!;
assert.equal(a.station, 'Toronto Downtown'); assert.equal(a.value, 2); assert.equal(a.risk, 'Low'); assert.equal(a.observed, Date.parse('2026-11-17T01:00:00Z')); assert.ok(a.distanceMi < 3);
assert.deepEqual(parseAqhi({ features: [aq('X', -79.4, 43.7, null), aq('Y', -79.4, 43.7, 'n/a'), aq('Z', -79.4, 43.7, 3, 'junk')] }, toronto), { station: null }, 'unreadable readings are skipped');
assert.deepEqual(parseAqhi({ features: [] }, toronto), { station: null }); assert.equal(parseAqhi(null, toronto), null); assert.equal(parseAqhi({}, toronto), null);
assert.equal(parseAqhi({ features: [aq('Low', -79.4, 43.7, 0.2)] }, toronto)!.station!.value, 1, 'the index starts at 1');
for (const [v, risk] of [[1, 'Low'], [3.4, 'Low'], [3.6, 'Moderate'], [6, 'Moderate'], [7, 'High'], [10, 'High'], [10.6, 'Very high']] as const) assert.equal(aqhiRisk(v), risk, String(v));
console.log('ecan tests passed');
