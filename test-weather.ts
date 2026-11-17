import assert from 'node:assert/strict';
import { parseForecast, parseGeocode, describeNetworkError, findPlaces, rankPlaces, nextHours, toTemp, toWind, tempUnit, windUnit, defaultUnits, parsePrefs, parseStoredPlace, backdropFor, BACKDROP_FILES, describeCode, forecastUrl, geocodeUrl, weekday } from './src/utils/weather';
const ok = { timezone: 'America/Denver', current: { time: '2026-11-16T02:00', temperature_2m: 34.7, apparent_temperature: 28.4, relative_humidity_2m: 82, wind_speed_10m: 4.9, weather_code: 0, is_day: 0 },
  daily: { time: ['2026-11-16', '2026-11-17'], weather_code: [0, 61], temperature_2m_max: [50, 45], temperature_2m_min: [30, 28], precipitation_probability_max: [0, 60] } };
const withHours = { ...ok, hourly: { time: ['2026-11-16T01:00', '2026-11-16T02:00', '2026-11-16T03:00'], temperature_2m: [1, 2, 3], weather_code: [0, 0, 61], precipitation_probability: [0, 5, 40] } };
const rh = parseForecast(withHours, 1)!; assert.equal(rh.hours.length, 3); assert.deepEqual(nextHours(rh).map((h) => h.temperature), [2, 3], 'starts at the current hour');
assert.deepEqual(parseForecast({ ...ok, hourly: { time: ['x'], temperature_2m: [null], weather_code: [0] } }, 1)!.hours, [], 'bad hourly is dropped, forecast still valid');
assert.equal(toTemp(0, 'us'), 32); assert.equal(toTemp(-17.8, 'us'), 0); assert.equal(toTemp(21.4, 'metric'), 21); assert.equal(toWind(16.09344, 'us'), 10); assert.equal(toWind(10, 'metric'), 10);
assert.equal(tempUnit('us'), '°F'); assert.equal(windUnit('metric'), 'km/h'); assert.equal(defaultUnits('en-US'), 'us'); assert.equal(defaultUnits('en-CA'), 'metric'); assert.equal(defaultUnits(''), 'metric');
assert.deepEqual(parsePrefs('{"units":"us","plain":true}'), { units: 'us', plain: true }); assert.deepEqual(parsePrefs('{bad'), { units: null, plain: false }); assert.equal(parsePrefs('{"units":"kelvin"}').units, null);
const r = parseForecast(ok, 1)!; assert.deepEqual(r.hours, []); assert.equal(r.days.length, 2); assert.equal(r.current.isDay, false); assert.equal(r.days[1].precipChance, 60);
assert.equal(parseForecast(null, 1), null); assert.equal(parseForecast({ current: {}, daily: {} }, 1), null);
assert.equal(parseForecast({ ...ok, daily: { ...ok.daily, temperature_2m_max: [50] } }, 1), null, 'short arrays are rejected, not padded');
assert.equal(parseGeocode({ results: [{ name: 'Raleigh', admin1: 'North Carolina', country: 'United States', latitude: 35.77, longitude: -78.63 }, { name: 'bad' }] }).length, 1);
assert.deepEqual(parseGeocode({}), []);
assert.equal(parseStoredPlace('{"name":"X","latitude":95,"longitude":0}'), null); assert.equal(parseStoredPlace('{bad'), null); assert.equal(parseStoredPlace(null), null);
assert.equal(backdropFor(0, true), 32); assert.equal(backdropFor(0, false), 31); assert.equal(backdropFor(95, true), 4); assert.equal(backdropFor(1234, true), 'na');
assert.equal(describeCode(61), 'Light rain'); assert.equal(describeCode(999), 'Conditions unavailable');
for (const n of BACKDROP_FILES) assert.ok(n === 'na' || (n >= 0 && n <= 47));
assert.ok(forecastUrl({ latitude: 35.7721, longitude: -78.6386 }).includes('latitude=35.7721')); assert.ok(geocodeUrl(' Raleigh ').includes('name=Raleigh'));
assert.equal(weekday('2026-11-16'), 'Mon');
const vic = { results: [
  { name: 'Victoria', admin1: 'British Columbia', country: 'Canada', country_code: 'CA', latitude: 48.43, longitude: -123.37 },
  { name: 'Victoria', admin1: 'Texas', country: 'United States', country_code: 'US', latitude: 28.8, longitude: -97 },
  { name: 'Victoria', admin1: 'Central and Western', country: 'Hong Kong', country_code: 'HK', latitude: 22.3, longitude: 114.1 }] };
const calls: string[] = []; const fake = async (u: string) => { calls.push(u); return new URL(u).searchParams.get('name')?.toLowerCase() === 'victoria' ? vic : {}; };
const names = async (q: string) => (await findPlaces(q, fake)).map((h) => `${h.name},${h.region}`);
assert.deepEqual(await names('Victoria'), ['Victoria,British Columbia', 'Victoria,Texas', 'Victoria,Central and Western']);
assert.deepEqual(await names('Victoria BC canada'), ['Victoria,British Columbia'], 'abbreviation + country narrow the list');
assert.deepEqual(await names('Victoria, TX'), ['Victoria,Texas']); assert.deepEqual(await names('victoria usa'), ['Victoria,Texas']);
assert.deepEqual(await names('Victoria Mars'), ['Victoria,British Columbia', 'Victoria,Texas', 'Victoria,Central and Western'], 'no word matches: still offers the choices');
assert.deepEqual(await names('Nowhere Land'), []); assert.deepEqual(await names('a'), []);
assert.equal(rankPlaces([], ['x']).length, 0);
assert.ok(describeNetworkError(new TypeError('Failed to fetch'), 'api.open-meteo.com').includes('api.open-meteo.com')); assert.equal(describeNetworkError(new Error('HTTP 500'), 'x'), 'HTTP 500');
console.log('weather tests passed', BACKDROP_FILES.length, 'backdrops');
