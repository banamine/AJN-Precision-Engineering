import assert from 'node:assert/strict';
import { categoryFrom, ceilingFt, distanceMi, nearbyStations, parseMetarList, parseTaf, tafRibbon, visibilitySm, ageLabel, cloudText, metarUrl, tafUrl } from './src/utils/aviation';
import { alertsApplicable, alertsUrl, parseAlerts } from './src/utils/alerts';
import { handleAviation, metarUrl as srvMetar, tafUrl as srvTaf, defaultAviationDeps } from './server/routes/aviationWeather';

// --- visibility / category
assert.equal(visibilitySm('10+'), 10); assert.equal(visibilitySm('1 1/2'), 1.5); assert.equal(visibilitySm('1/4'), 0.25); assert.equal(visibilitySm(7), 7); assert.equal(visibilitySm('x'), null); assert.equal(visibilitySm(null), null);
assert.equal(categoryFrom(10, null), 'VFR'); assert.equal(categoryFrom(15, 1900), 'MVFR'); assert.equal(categoryFrom(2, 5000), 'IFR'); assert.equal(categoryFrom(0.5, null), 'LIFR'); assert.equal(categoryFrom(10, 400), 'LIFR'); assert.equal(categoryFrom(5, null), 'MVFR'); assert.equal(categoryFrom(null, null), null);
assert.equal(ceilingFt([{ cover: 'FEW', baseFt: 500 }, { cover: 'BKN', baseFt: 3000 }, { cover: 'OVC', baseFt: 8000 }]), 3000); assert.equal(ceilingFt([{ cover: 'SCT', baseFt: 900 }]), null);
assert.equal(cloudText([]), 'Sky clear'); assert.equal(cloudText([{ cover: 'OVC', baseFt: 1900 }]), 'OVC 1,900 ft'); assert.equal(ageLabel(18), '18 min ago'); assert.equal(ageLabel(75), '1 h 15 min ago');

// --- METAR (shapes copied from live AviationWeather.gov answers)
const live = [
  { icaoId: 'KDEN', name: 'Denver Intl', lat: 39.8466, lon: -104.6562, obsTime: 1794876780, temp: 9.4, dewp: -0.6, wdir: 50, wspd: 3, wgst: null, visib: '10+', altim: 1017.4, fltCat: 'VFR', clouds: [{ cover: 'BKN', base: 22000 }], rawOb: 'METAR KDEN ...' },
  { icaoId: 'CYYZ', name: 'Toronto/Pearson Intl, ON, CA', lat: 43.679, lon: -79.629, obsTime: 1794877200, temp: 6, dewp: 2, wdir: 270, wspd: 10, wgst: null, visib: 15, altim: 1031.9, fltCat: 'MVFR', clouds: [{ cover: 'OVC', base: 1900 }], rawOb: 'METAR CYYZ ...' },
  { icaoId: 'KBJC', name: 'Rocky Mtn Metro', lat: 39.9088, lon: -105.1172, obsTime: 1794876000, temp: 8, dewp: 1, wdir: 'VRB', wspd: 2, wgst: 18, visib: 10, altim: 1017, clouds: [], rawOb: '' },
  { icaoId: 'BAD', lat: 1, lon: 1 }, { icaoId: 'NOTEMP', lat: 39.9, lon: -105, obsTime: 1, wspd: 1 }, 'junk',
];
const ms = parseMetarList(live); assert.equal(ms.length, 3, 'unreadable records are skipped'); assert.equal(parseMetarList({}).length, 0);
assert.equal(ms[0].category, 'VFR'); assert.equal(ms[0].visibSm, 10); assert.ok(Math.abs((ms[0].altimInHg ?? 0) - 30.04) < 0.01);
assert.equal(ms[2].windVariable, true); assert.equal(ms[2].gustKt, 18); assert.equal(ms[2].category, 'VFR', 'category derived when the service sends none');
const near = nearbyStations(ms, 39.7392, -104.9903); assert.deepEqual(near.map((n) => n.metar.icao), ['KBJC', 'KDEN'], 'Toronto is far outside 60 mi; Rocky Mtn Metro is closer to downtown Denver than DIA'); assert.ok(near[0].distanceMi < near[1].distanceMi); assert.ok(near[0].distanceMi > 8 && near[0].distanceMi < 20); assert.equal(near[0].bearing, 'NW'); assert.equal(near[1].bearing, 'NE');
assert.equal(nearbyStations(ms, 0, 0).length, 0); assert.ok(Math.abs(distanceMi(0, 0, 0, 1) - 69.09) < 0.2);
assert.equal(nearbyStations([{ ...ms[0], obsTime: 1 }, ms[0]], 39.84, -104.65).length, 1, 'one report per airport');
assert.ok(metarUrl(39.7392, -104.9903).startsWith('/api/aviation/metar?lat=39.739&lon=-104.990')); assert.equal(tafUrl('KDEN'), '/api/aviation/taf?ids=KDEN');

// --- TAF + ribbon
const tafJson = [{ icaoId: 'KDEN', rawTAF: 'TAF KDEN ...', validTimeFrom: 1000, validTimeTo: 1000 + 30 * 3600, fcsts: [
  { timeFrom: 1000, timeTo: 4600, fcstChange: null, wdir: 50, wspd: 7, visib: '6+', clouds: [{ cover: 'FEW', base: 22000 }] },
  { timeFrom: 4600, timeTo: 8200, fcstChange: 'FM', wdir: 350, wspd: 7, visib: '6+', clouds: [{ cover: 'BKN', base: 22000 }] },
  { timeFrom: 8200, timeTo: 20000, fcstChange: 'FM', wspd: 9, visib: 2, clouds: [{ cover: 'OVC', base: 800 }], wxString: '-SN' },
  { timeFrom: 9000, timeTo: 12000, fcstChange: 'TEMPO', visib: 0.5, clouds: [] },
  { timeFrom: 20000, timeTo: 1000 + 30 * 3600, fcstChange: 'FM', visib: '6+', clouds: [{ cover: 'SCT', base: 9000 }] }] }];
const taf = parseTaf(tafJson)!; assert.equal(taf.groups.length, 5); assert.equal(taf.groups[2].category, 'IFR');
assert.equal(parseTaf([]), null); assert.equal(parseTaf([{ icaoId: 'X' }]), null); assert.equal(parseTaf([{ ...tafJson[0], fcsts: [{ timeFrom: 'x' }] }]), null);
const rib = tafRibbon(taf, 2000); assert.deepEqual(rib.map((r) => r.category), ['VFR', 'IFR', 'VFR'], 'adjacent VFR groups merge; TEMPO is not drawn'); assert.equal(rib[0].from, 2000); assert.equal(rib[rib.length - 1].to, 2000 + 24 * 3600);
assert.deepEqual(tafRibbon(taf, 1000 + 40 * 3600), [], 'nothing after the forecast ends');

// --- NWS alerts
const feat = (event: string, severity: string, ends: string | null) => ({ id: event, properties: { event, severity, headline: `${event} headline`, areaDesc: 'Denver', senderName: 'NWS Boulder', ends, expires: ends } });
const nowMs = Date.parse('2026-11-16T20:00:00Z');
const al = parseAlerts({ features: [feat('Flood Watch', 'Moderate', '2026-11-17T20:00:00Z'), feat('Winter Storm Warning', 'Severe', '2026-11-17T01:00:00Z'), feat('Old', 'Severe', '2026-11-16T10:00:00Z'), feat('Odd', 'Weird', null)] }, nowMs)!;
assert.deepEqual(al.map((a) => a.event), ['Winter Storm Warning', 'Flood Watch', 'Odd'], 'most severe first, expired dropped'); assert.equal(al[2].severity, 'Unknown');
assert.deepEqual(parseAlerts({ features: [] }, nowMs), []); assert.equal(parseAlerts({}, nowMs), null); assert.equal(parseAlerts({ features: [{ properties: {} }] }, nowMs), null, 'malformed is an error, never "all clear"'); assert.equal(parseAlerts(null, nowMs), null);
assert.equal(alertsApplicable({ country: 'United States' }), true); assert.equal(alertsApplicable({ country: '' }), true); assert.equal(alertsApplicable({ country: 'Canada' }), false);
assert.equal(alertsUrl({ latitude: 39.7392, longitude: -104.9903 }), 'https://api.weather.gov/alerts/active?point=39.7392,-104.9903');

// --- server route
assert.equal(srvMetar({ lat: 'x', lon: '1' }), null); assert.equal(srvMetar({ lat: '95', lon: '1' }), null); assert.equal(srvMetar({ lat: '39.7', lon: '-104.99; rm' }), null); assert.equal(srvMetar({}), null);
assert.ok(srvMetar({ lat: '39.739', lon: '-104.990' })!.startsWith('https://aviationweather.gov/api/data/metar?bbox=38.95,'));
assert.equal(srvTaf({ ids: 'kden' }), 'https://aviationweather.gov/api/data/taf?ids=KDEN&format=json'); assert.equal(srvTaf({ ids: 'KDEN,KBJC' }), 'https://aviationweather.gov/api/data/taf?ids=KDEN,KBJC&format=json');
for (const bad of ['', 'K', 'KDENX', 'KD/N', '../x', 'A,B,C,D', 'KDEN&x=1', undefined]) assert.equal(srvTaf({ ids: bad as string }), null, `rejects ${String(bad)}`);
let t = 1_000_000; const calls: string[] = []; let mode: 'ok' | 'fail' | 'empty' = 'ok';
const mkRes = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response;
const deps = { ...defaultAviationDeps(), now: () => t, fetchImpl: (async (u: string, init?: RequestInit) => { calls.push(u); assert.ok((init?.headers as Record<string, string>)['User-Agent'].includes('AJN'), 'identifies itself'); return mode === 'fail' ? mkRes(503, '') : mode === 'empty' ? mkRes(204, '') : mkRes(200, JSON.stringify(live.slice(0, 1))); }) as unknown as typeof fetch };
const q = { lat: '39.739', lon: '-104.990' };
let r = await handleAviation('metar', q, deps); assert.equal(r.status, 200); assert.equal((r.body.data as unknown[]).length, 1); assert.equal(r.body.stale, false); assert.equal(calls.length, 1);
t += 30_000; r = await handleAviation('metar', q, deps); assert.equal(calls.length, 1, 'cached for 60 s');
t += 40_000; mode = 'fail'; r = await handleAviation('metar', q, deps); assert.equal(r.status, 200); assert.equal(r.body.stale, true, 'recent answer served and flagged stale'); assert.equal(calls.length, 2);
t += 11 * 60_000; r = await handleAviation('metar', q, deps); assert.equal(r.status, 502); assert.equal(r.body.ok, false, 'old data is never served');
mode = 'empty'; r = await handleAviation('metar', { lat: '0', lon: '0' }, deps); assert.deepEqual(r.body.data, [], '204 = no stations, not an error');
r = await handleAviation('taf', { ids: '../' }, deps); assert.equal(r.status, 400);
const d2 = { ...defaultAviationDeps(), now: () => t, fetchImpl: (async () => mkRes(200, '{"not":"array"}')) as unknown as typeof fetch }; r = await handleAviation('taf', { ids: 'KDEN' }, d2); assert.equal(r.status, 502, 'non-array upstream answer is an error');
const d3 = { ...defaultAviationDeps(), now: () => t, fetchImpl: (async () => mkRes(200, '[]')) as unknown as typeof fetch }; let last = 0;
for (let i = 0; i < 65; i++) { last = (await handleAviation('metar', { lat: String(i), lon: '10' }, d3)).status; } assert.equal(last, 429, 'our own upstream limit protects the 100/min allowance');
console.log('aviation tests passed');
