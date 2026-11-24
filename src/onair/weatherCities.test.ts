import assert from 'node:assert/strict';
import test from 'node:test';
import { WEATHER_CITIES, WEATHER_CITY_MS, weatherCityAt } from './useOnAirData';

test('weather cities: the six US and six Canadian cities the owner chose, alternating US / Canada', () => {
  assert.equal(WEATHER_CITIES.length, 12);
  assert.deepEqual(WEATHER_CITIES.filter((c) => c.country === 'Canada').map((c) => c.name).sort(), ['Calgary', 'Montreal', 'Ottawa', 'Quebec City', 'Toronto', 'Vancouver']);
  assert.deepEqual(WEATHER_CITIES.filter((c) => c.country === 'United States').map((c) => c.name).sort(), ['Boston', 'Chicago', 'Los Angeles', 'Miami', 'New York City', 'San Francisco']);
  WEATHER_CITIES.forEach((c, i) => assert.equal(c.country, i % 2 === 0 ? 'United States' : 'Canada'));
});
test('the city changes every 5 minutes, in list order, and wraps', () => {
  assert.equal(weatherCityAt(0).name, WEATHER_CITIES[0].name);
  assert.equal(weatherCityAt(WEATHER_CITY_MS - 1).name, WEATHER_CITIES[0].name);
  assert.equal(weatherCityAt(WEATHER_CITY_MS).name, WEATHER_CITIES[1].name);
  assert.equal(weatherCityAt(WEATHER_CITY_MS * 12).name, WEATHER_CITIES[0].name);
});
test('every weather city has a photo category on the server under the same key', async () => {
  const { CITY_CATEGORIES } = await import('../../server/cityPhotos');
  const { cityKeyOf } = await import('./useOnAirData');
  for (const c of WEATHER_CITIES) assert.ok(CITY_CATEGORIES[cityKeyOf(c.name)], c.name);
});
