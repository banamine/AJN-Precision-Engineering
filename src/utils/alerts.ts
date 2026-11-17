/* Official US alerts from the National Weather Service (api.weather.gov, free, no key, open to browser calls).
 * Only US places are asked. "No alerts" is an empty list; a malformed answer is null (shown as an error, never as "all clear"). */
import type { WeatherPlace } from './weather';
export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
export interface WxAlert { id: string; event: string; severity: AlertSeverity; headline: string; area: string; sender: string; expires: number | null; url: string | null }
const RANK: Record<AlertSeverity, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const alertsUrl = (p: Pick<WeatherPlace, 'latitude' | 'longitude'>): string => `https://api.weather.gov/alerts/active?point=${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
/** The NWS only covers the US. A place chosen from search carries its country; "My location" has none, so it is tried and a 404 means "not available here". */
export const alertsApplicable = (p: Pick<WeatherPlace, 'country'>): boolean => p.country === '' || /^united states/i.test(p.country);

export function parseAlerts(json: unknown, now: number): WxAlert[] | null {
  if (!isObj(json) || !Array.isArray(json.features)) return null;
  const out: WxAlert[] = [];
  for (const f of json.features) {
    if (!isObj(f) || !isObj(f.properties)) return null;
    const p = f.properties; const event = str(p.event); if (!event) return null;
    const end = Date.parse(str(p.ends) || str(p.expires)); const expires = Number.isFinite(end) ? end : null;
    if (expires !== null && expires < now) continue;
    const sev = str(p.severity); const severity: AlertSeverity = sev === 'Extreme' || sev === 'Severe' || sev === 'Moderate' || sev === 'Minor' ? sev : 'Unknown';
    out.push({ id: str(f.id) || str(p.id) || `${event}-${expires ?? ''}`, event, severity, headline: str(p.headline), area: str(p.areaDesc), sender: str(p.senderName), expires, url: null });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.expires ?? Infinity) - (b.expires ?? Infinity));
}
