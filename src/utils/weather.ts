/* Weather page helpers: pure and testable. Data comes from Open-Meteo (free, no key, CORS open) fetched in the browser.
 * Nothing is invented: a failed or malformed response is an error state, never a made-up forecast. */
export interface WeatherPlace { name: string; region: string; country: string; latitude: number; longitude: number }
export interface WeatherCurrent { temperature: number; feelsLike: number; humidity: number; windKmh: number; code: number; isDay: boolean; time: string }
export interface WeatherDay { date: string; code: number; high: number; low: number; precipChance: number | null }
export interface WeatherHour { time: string; temperature: number; code: number; precipChance: number | null }
export interface WeatherReport { current: WeatherCurrent; days: WeatherDay[]; hours: WeatherHour[]; timezone: string; fetchedAt: number }
/** Values are kept in the service's own units (Celsius, km/h) and converted only for display, so the unit switch never needs a new request. */
export type Units = 'us' | 'metric';

export const PLACE_KEY = 'ajn.weather.place.v1';
export const LAST_KEY = 'ajn.weather.last.v1';
export const PREFS_KEY = 'ajn.weather.prefs.v1';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function forecastUrl(p: Pick<WeatherPlace, 'latitude' | 'longitude'>): string {
  const q = new URLSearchParams({
    latitude: p.latitude.toFixed(4), longitude: p.longitude.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    timezone: 'auto', forecast_days: '5',
  });
  return `${FORECAST}?${q.toString()}`;
}
export const geocodeUrl = (query: string, count = 20): string => `${GEOCODE}?${new URLSearchParams({ name: query.trim(), count: String(count), language: 'en', format: 'json' }).toString()}`;

/** Strict parse. Returns null for anything that is not a complete response. */
export function parseForecast(json: unknown, now: number): WeatherReport | null {
  if (!isObj(json) || !isObj(json.current) || !isObj(json.daily)) return null;
  const c = json.current; const d = json.daily;
  if (!finite(c.temperature_2m) || !finite(c.weather_code) || typeof c.time !== 'string') return null;
  const dates = d.time; const codes = d.weather_code; const hi = d.temperature_2m_max; const lo = d.temperature_2m_min; const pp = d.precipitation_probability_max;
  if (!Array.isArray(dates) || !Array.isArray(codes) || !Array.isArray(hi) || !Array.isArray(lo)) return null;
  const days: WeatherDay[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (typeof dates[i] !== 'string' || !finite(codes[i]) || !finite(hi[i]) || !finite(lo[i])) return null;
    days.push({ date: dates[i] as string, code: codes[i] as number, high: hi[i] as number, low: lo[i] as number, precipChance: Array.isArray(pp) && finite(pp[i]) ? (pp[i] as number) : null });
  }
  if (!days.length) return null;
  return {
    current: { temperature: c.temperature_2m, feelsLike: finite(c.apparent_temperature) ? c.apparent_temperature : c.temperature_2m, humidity: finite(c.relative_humidity_2m) ? c.relative_humidity_2m : 0, windKmh: finite(c.wind_speed_10m) ? c.wind_speed_10m : 0, code: c.weather_code, isDay: c.is_day !== 0, time: c.time },
    days, hours: parseHours(json.hourly), timezone: typeof json.timezone === 'string' ? json.timezone : '', fetchedAt: now,
  };
}
function parseHours(h: unknown): WeatherHour[] {
  if (!isObj(h) || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m) || !Array.isArray(h.weather_code)) return [];
  const pp = h.precipitation_probability; const out: WeatherHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    if (typeof h.time[i] !== 'string' || !finite(h.temperature_2m[i]) || !finite(h.weather_code[i])) return [];
    out.push({ time: h.time[i] as string, temperature: h.temperature_2m[i] as number, code: h.weather_code[i] as number, precipChance: Array.isArray(pp) && finite(pp[i]) ? (pp[i] as number) : null });
  }
  return out;
}
/** The next `n` hours starting at the current hour (times are local to the place, so plain string comparison is correct). */
export function nextHours(r: WeatherReport, n = 12): WeatherHour[] { const from = r.current.time.slice(0, 13); return r.hours.filter((h) => h.time >= from).slice(0, n); }
export const toTemp = (c: number, u: Units): number => Math.round(u === 'us' ? (c * 9) / 5 + 32 : c) || 0; // || 0 turns -0 into 0
export const toWind = (kmh: number, u: Units): number => Math.round(u === 'us' ? kmh / 1.609344 : kmh);
export const tempUnit = (u: Units): string => (u === 'us' ? '°F' : '°C');
export const windUnit = (u: Units): string => (u === 'us' ? 'mph' : 'km/h');
/** First visit default only: US English gets °F, everyone else °C. The switch overrides it and is remembered. */
export const defaultUnits = (lang: string): Units => (lang === 'en-US' ? 'us' : 'metric');
export interface WeatherPrefs { units: Units | null; plain: boolean }
export function parsePrefs(raw: string | null): WeatherPrefs {
  try { const v = JSON.parse(raw ?? 'null'); return isObj(v) ? { units: v.units === 'us' || v.units === 'metric' ? v.units : null, plain: v.plain === true } : { units: null, plain: false }; } catch { return { units: null, plain: false }; }
}
export interface GeoHit extends WeatherPlace { admin2: string; countryCode: string }
export function parseGeocode(json: unknown): GeoHit[] {
  if (!isObj(json) || !Array.isArray(json.results)) return [];
  return json.results.filter(isObj).filter((r) => typeof r.name === 'string' && finite(r.latitude) && finite(r.longitude))
    .map((r) => ({ name: r.name as string, region: typeof r.admin1 === 'string' ? r.admin1 : '', country: typeof r.country === 'string' ? r.country : '', admin2: typeof r.admin2 === 'string' ? r.admin2 : '', countryCode: typeof r.country_code === 'string' ? r.country_code : '', latitude: r.latitude as number, longitude: r.longitude as number }));
}
export const placeLabel = (p: WeatherPlace): string => [p.name, p.region, p.country].filter(Boolean).join(', ');
export function parseStoredPlace(raw: string | null): WeatherPlace | null {
  try { const v = JSON.parse(raw ?? 'null'); return isObj(v) && typeof v.name === 'string' && finite(v.latitude) && finite(v.longitude) && Math.abs(v.latitude) <= 90 && Math.abs(v.longitude) <= 180 ? { name: v.name, region: typeof v.region === 'string' ? v.region : '', country: typeof v.country === 'string' ? v.country : '', latitude: v.latitude, longitude: v.longitude } : null; } catch { return null; }
}

/** WMO weather code -> words (Open-Meteo uses WMO codes). Unknown codes say so. */
export function describeCode(code: number): string {
  const t: Record<number, string> = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail' };
  return t[code] ?? 'Conditions unavailable';
}

/** Backdrop file number (the pack's own numbering, public/weather-bg/<n>.jpg) for a WMO code. Picked by looking at the pictures; edit this one table to swap a picture. */
const DAY_NIGHT: Record<number, [number, number]> = { 0: [32, 31], 1: [34, 33], 2: [44, 29], 3: [26, 27] };
const OTHER: Record<number, number> = { 45: 20, 48: 20, 51: 9, 53: 9, 55: 9, 56: 10, 57: 10, 61: 11, 63: 11, 65: 40, 66: 10, 67: 10, 71: 13, 73: 16, 75: 42, 77: 7, 80: 39, 81: 12, 82: 40, 85: 41, 86: 43, 95: 4, 96: 17, 99: 17 };
export const BACKDROP_FILES: readonly (number | 'na')[] = [...new Set([...Object.values(DAY_NIGHT).flat(), ...Object.values(OTHER), 'na' as const])].sort((a, b) => (a === 'na' ? 1 : b === 'na' ? -1 : (a as number) - (b as number)));
export function backdropFor(code: number, isDay: boolean): number | 'na' {
  const dn = DAY_NIGHT[code]; if (dn) return isDay ? dn[0] : dn[1];
  return OTHER[code] ?? 'na';
}
export const backdropUrl = (n: number | 'na'): string => `/weather-bg/${n}.jpg`;
export const weekday = (date: string): string => { const d = new Date(`${date}T12:00:00Z`); return Number.isNaN(d.getTime()) ? date : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]; };

/* ---- Place search. The geocoder only matches the city NAME, so "Victoria BC canada" finds nothing. We search the longest leading run of words that
 * returns results, then use the remaining words (province/state, country, abbreviations) to pick and order the matches. ---- */
const REGION_ABBREV: Record<string, string> = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', bc: 'british columbia', ab: 'alberta', sk: 'saskatchewan', mb: 'manitoba', on: 'ontario', qc: 'quebec', nb: 'new brunswick', ns: 'nova scotia', pe: 'prince edward island', nl: 'newfoundland and labrador', yt: 'yukon', nt: 'northwest territories', nu: 'nunavut' };
const COUNTRY_ALIAS: Record<string, string> = { usa: 'united states', us: 'united states', uk: 'united kingdom', gb: 'united kingdom' };
const norm = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f.']/g, '');
function termMatches(h: GeoHit, term: string): boolean {
  const t = norm(term); const want = [t, REGION_ABBREV[t], COUNTRY_ALIAS[t]].filter((x): x is string => !!x);
  const fields = [h.region, h.admin2, h.country, h.name].map(norm);
  return want.some((w) => fields.some((f) => f === w || f.startsWith(w)) || (w.length === 2 && h.countryCode.toLowerCase() === w));
}
/** Keep the matches that satisfy every extra word (state, province, country); if none do, keep all so the user can still pick. Order is otherwise the service's own. */
export function rankPlaces(hits: GeoHit[], terms: string[]): GeoHit[] {
  if (!terms.length) return hits;
  const all = hits.filter((h) => terms.every((t) => termMatches(h, t)));
  return all.length ? all : hits;
}
export async function findPlaces(query: string, fetchJson: (url: string) => Promise<unknown>, limit = 8): Promise<GeoHit[]> {
  const words = query.split(/[\s,]+/).filter(Boolean);
  for (let n = words.length; n >= 1; n--) {
    const name = words.slice(0, n).join(' ');
    if (name.length < 2) continue;
    const hits = parseGeocode(await fetchJson(geocodeUrl(name)));
    if (hits.length) return rankPlaces(hits, words.slice(n)).slice(0, limit);
  }
  return [];
}

/** A browser reports a blocked/lost request as a bare TypeError ("Failed to fetch"). Say what that usually means and which host, so the next test shows the real cause. */
export function describeNetworkError(e: unknown, host: string): string {
  if (e instanceof TypeError) return `Could not reach ${host}. The browser blocked or lost the request (offline, an ad/privacy blocker, or a network block). Open the browser's Console/Network tab for the exact reason`;
  return e instanceof Error ? e.message : `Could not reach ${host}`;
}
