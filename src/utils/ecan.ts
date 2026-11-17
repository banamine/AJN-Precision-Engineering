/* Canada: official warnings (Environment and Climate Change Canada, City Page Weather) and the Air Quality Health Index (AQHI).
 * Both come straight from api.weather.gc.ca (free, no key, open to browser calls) with a SMALL search box around the place:
 * never ask for the whole collection (it is ~27 MB). Alert wording is shown exactly as issued (a licence condition). */
import type { WeatherPlace } from './weather';
import type { AlertSeverity, WxAlert } from './alerts';
import { distanceMi } from './aviation';

const BASE = 'https://api.weather.gc.ca/collections';
export const EC_RADIUS_MI = 20;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const en = (v: unknown): string => (isObj(v) && typeof v.en === 'string' ? v.en : typeof v === 'string' ? v : '');
const box = (p: Pick<WeatherPlace, 'latitude' | 'longitude'>, dLat: number): string => {
  const dLon = Math.min(8, dLat / Math.max(0.2, Math.cos((p.latitude * Math.PI) / 180)));
  return `${(p.longitude - dLon).toFixed(3)},${(p.latitude - dLat).toFixed(3)},${(p.longitude + dLon).toFixed(3)},${(p.latitude + dLat).toFixed(3)}`;
};
/** Canada only. "My location" has no country, so it is tried and an empty answer means "not covered". */
export const ecApplicable = (p: Pick<WeatherPlace, 'country'>): boolean => p.country === '' || p.country === 'Canada';
export const ecWarningsUrl = (p: Pick<WeatherPlace, 'latitude' | 'longitude'>): string => `${BASE}/citypageweather-realtime/items?f=json&limit=10&bbox=${box(p, 0.3)}`;
export const aqhiUrl = (p: Pick<WeatherPlace, 'latitude' | 'longitude'>): string => `${BASE}/aqhi-observations-realtime/items?f=json&latest=true&limit=10&bbox=${box(p, 0.7)}`;

function point(f: unknown): { lat: number; lon: number } | null {
  if (!isObj(f) || !isObj(f.geometry) || f.geometry.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) return null;
  const [lon, lat] = f.geometry.coordinates; return finite(lat) && finite(lon) ? { lat, lon } : null;
}
function nearest<T>(features: unknown[], p: Pick<WeatherPlace, 'latitude' | 'longitude'>): { f: T; mi: number } | null {
  let best: { f: T; mi: number } | null = null;
  for (const f of features) { const pt = point(f); if (!pt) continue; const mi = distanceMi(p.latitude, p.longitude, pt.lat, pt.lon); if (!best || mi < best.mi) best = { f: f as T, mi }; }
  return best;
}

/** Warning colour words are Canada's own (yellow / orange / red). Seen live so far: statements and yellow warnings; the rest is by the published colour scheme. */
export function ecSeverity(type: string, description: string): AlertSeverity {
  const t = type.toLowerCase(); const d = description.toUpperCase();
  if (t === 'warning') return d.startsWith('RED') ? 'Extreme' : d.startsWith('ORANGE') ? 'Severe' : 'Moderate';
  if (t === 'watch') return 'Moderate';
  if (t === 'statement' || t === 'advisory') return 'Minor';
  return 'Unknown';
}
export interface EcWarnings { place: string | null; alerts: WxAlert[] }
/** place === null: no forecast point within EC_RADIUS_MI (not covered). null result: malformed answer. */
export function parseEcWarnings(json: unknown, p: Pick<WeatherPlace, 'latitude' | 'longitude'>, now: number): EcWarnings | null {
  if (!isObj(json) || !Array.isArray(json.features)) return null;
  const hit = nearest<Record<string, unknown>>(json.features, p);
  if (!hit || hit.mi > EC_RADIUS_MI) return { place: null, alerts: [] };
  const props = hit.f.properties; if (!isObj(props)) return null;
  const name = en(props.name); const warnings = props.warnings;
  if (!Array.isArray(warnings)) return null;
  const alerts: WxAlert[] = [];
  for (const w of warnings) {
    if (!isObj(w)) return null;
    const type = en(w.type); const description = en(w.description); if (!description) return null;
    if (type.toLowerCase() === 'ended') continue;
    const exp = Date.parse(en(w.expiryTime)); const expires = Number.isFinite(exp) ? exp : null;
    if (expires !== null && expires < now) continue;
    alerts.push({ id: en(w.url) || `${description}-${en(w.eventIssue)}`, event: description, severity: ecSeverity(type, description), headline: '', area: name ? `Issued for ${name}` : '', sender: 'Environment Canada', expires, url: /^https:\/\//.test(en(w.url)) ? en(w.url) : null });
  }
  const rank: Record<AlertSeverity, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
  return { place: name || 'nearby', alerts: alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.expires ?? Infinity) - (b.expires ?? Infinity)) };
}

export type AqhiRisk = 'Low' | 'Moderate' | 'High' | 'Very high';
export interface Aqhi { value: number; risk: AqhiRisk; station: string; observed: number; distanceMi: number }
/** Health-risk bands of the Air Quality Health Index: 1-3 low, 4-6 moderate, 7-10 high, above 10 very high. */
export const aqhiRisk = (v: number): AqhiRisk => { const r = Math.round(v); return r <= 3 ? 'Low' : r <= 6 ? 'Moderate' : r <= 10 ? 'High' : 'Very high'; };
export interface AqhiResult { station: Aqhi | null }
/** station === null: no reporting station near this place. null result: malformed answer. */
export function parseAqhi(json: unknown, p: Pick<WeatherPlace, 'latitude' | 'longitude'>): AqhiResult | null {
  if (!isObj(json) || !Array.isArray(json.features)) return null;
  const ok = json.features.filter((f) => isObj(f) && isObj(f.properties) && finite(f.properties.aqhi) && typeof f.properties.observation_datetime === 'string' && Number.isFinite(Date.parse(f.properties.observation_datetime)));
  const hit = nearest<{ properties: { aqhi: number; observation_datetime: string; location_name_en?: unknown } }>(ok, p);
  if (!hit) return { station: null };
  const pr = hit.f.properties;
  return { station: { value: Math.max(1, Math.round(pr.aqhi)), risk: aqhiRisk(pr.aqhi), station: typeof pr.location_name_en === 'string' ? pr.location_name_en : 'nearest station', observed: Date.parse(pr.observation_datetime), distanceMi: hit.mi } };
}
