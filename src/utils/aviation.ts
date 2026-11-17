/* Airport reports (METAR) and airport forecasts (TAF) from AviationWeather.gov, fetched through our own /api/aviation route
 * (that service does not allow browser calls). Strict parsing: a record that cannot be read completely is skipped, never patched up. */
export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
export interface CloudLayer { cover: string; baseFt: number | null }
export interface Metar { icao: string; name: string; lat: number; lon: number; obsTime: number; tempC: number; dewC: number | null; windDir: number | null; windVariable: boolean; windKt: number; gustKt: number | null; visibSm: number | null; clouds: CloudLayer[]; altimInHg: number | null; category: FlightCategory | null; raw: string }
export interface TafGroup { from: number; to: number; change: string | null; probability: number | null; category: FlightCategory | null; windDir: number | null; windKt: number | null; gustKt: number | null; visibSm: number | null; clouds: CloudLayer[]; weather: string | null }
export interface Taf { icao: string; raw: string; validFrom: number; validTo: number; groups: TafGroup[] }
export interface NearStation { metar: Metar; distanceMi: number; bearing: string }
export interface RibbonSegment { from: number; to: number; category: FlightCategory | null }

export const MAX_AIRPORT_MI = 60;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number | null => (finite(v) ? v : null);

export const metarUrl = (lat: number, lon: number): string => `/api/aviation/metar?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
export const tafUrl = (icao: string): string => `/api/aviation/taf?ids=${encodeURIComponent(icao)}`;

/** Visibility in statute miles. The service sends numbers or strings like "10+", "6+", "1/2" or "1 1/2". */
export function visibilitySm(v: unknown): number | null {
  if (finite(v)) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim(); let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\+?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  return null;
}
const parseClouds = (c: unknown): CloudLayer[] => (Array.isArray(c) ? c.filter(isObj).filter((l) => typeof l.cover === 'string').map((l) => ({ cover: l.cover as string, baseFt: num(l.base) })) : []);
export const ceilingFt = (clouds: CloudLayer[]): number | null => {
  const b = clouds.filter((l) => (l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'VV') && l.baseFt !== null).map((l) => l.baseFt as number);
  return b.length ? Math.min(...b) : null;
};
/** US flight-category rules: LIFR <1 SM or <500 ft; IFR 1 to <3 SM or 500 to <1000 ft; MVFR 3 to 5 SM or 1000 to 3000 ft; otherwise VFR. Null when nothing is known. */
export function categoryFrom(visibSm: number | null, ceiling: number | null): FlightCategory | null {
  if (visibSm === null && ceiling === null) return null;
  const v = visibSm ?? Infinity; const c = ceiling ?? Infinity;
  if (v < 1 || c < 500) return 'LIFR';
  if (v < 3 || c < 1000) return 'IFR';
  if (v <= 5 || c <= 3000) return 'MVFR';
  return 'VFR';
}
const asCategory = (v: unknown): FlightCategory | null => (v === 'VFR' || v === 'MVFR' || v === 'IFR' || v === 'LIFR' ? v : null);

export function parseMetarList(json: unknown): Metar[] {
  if (!Array.isArray(json)) return [];
  const out: Metar[] = [];
  for (const r of json) {
    if (!isObj(r) || typeof r.icaoId !== 'string' || !finite(r.lat) || !finite(r.lon) || !finite(r.obsTime) || !finite(r.temp) || !finite(r.wspd)) continue;
    const clouds = parseClouds(r.clouds); const visibSm = visibilitySm(r.visib);
    out.push({
      icao: r.icaoId, name: typeof r.name === 'string' ? r.name : r.icaoId, lat: r.lat, lon: r.lon, obsTime: r.obsTime, tempC: r.temp, dewC: num(r.dewp),
      windDir: finite(r.wdir) ? r.wdir : null, windVariable: r.wdir === 'VRB', windKt: r.wspd, gustKt: num(r.wgst), visibSm, clouds,
      altimInHg: finite(r.altim) ? r.altim / 33.8639 : null, category: asCategory(r.fltCat) ?? categoryFrom(visibSm, ceilingFt(clouds)), raw: typeof r.rawOb === 'string' ? r.rawOb : '',
    });
  }
  return out;
}
export function parseTaf(json: unknown): Taf | null {
  if (!Array.isArray(json)) return null;
  const t = json.find(isObj); if (!t || typeof t.icaoId !== 'string' || typeof t.rawTAF !== 'string' || !Array.isArray(t.fcsts) || !finite(t.validTimeFrom) || !finite(t.validTimeTo)) return null;
  const groups: TafGroup[] = [];
  for (const g of t.fcsts) {
    if (!isObj(g) || !finite(g.timeFrom) || !finite(g.timeTo)) return null;
    const clouds = parseClouds(g.clouds); const visibSm = visibilitySm(g.visib);
    groups.push({ from: g.timeFrom, to: g.timeTo, change: typeof g.fcstChange === 'string' ? g.fcstChange : null, probability: num(g.probability), category: categoryFrom(visibSm, ceilingFt(clouds)), windDir: num(g.wdir), windKt: num(g.wspd), gustKt: num(g.wgst), visibSm, clouds, weather: typeof g.wxString === 'string' ? g.wxString : null });
  }
  return { icao: t.icaoId, raw: t.rawTAF, validFrom: t.validTimeFrom, validTo: t.validTimeTo, groups };
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function compass(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
/** Closest stations first, only within MAX_AIRPORT_MI, one report per airport (the newest). */
export function nearbyStations(list: Metar[], lat: number, lon: number, limit = 4): NearStation[] {
  const newest = new Map<string, Metar>();
  for (const m of list) { const o = newest.get(m.icao); if (!o || m.obsTime > o.obsTime) newest.set(m.icao, m); }
  return [...newest.values()].map((m) => ({ metar: m, distanceMi: distanceMi(lat, lon, m.lat, m.lon), bearing: compass(lat, lon, m.lat, m.lon) }))
    .filter((s) => s.distanceMi <= MAX_AIRPORT_MI).sort((a, b) => a.distanceMi - b.distanceMi).slice(0, limit);
}

/** Flight-category ribbon for the next `hours` hours from the main TAF groups (initial, FM, BECMG). TEMPO and PROB groups are not drawn; they stay in the raw text. */
export function tafRibbon(taf: Taf, nowSec: number, hours = 24): RibbonSegment[] {
  const end = nowSec + hours * 3600; const segs: RibbonSegment[] = [];
  for (const g of taf.groups.filter((x) => x.change === null || x.change === 'FM' || x.change === 'BECMG').sort((a, b) => a.from - b.from)) {
    const from = Math.max(g.from, nowSec); const to = Math.min(g.to, end); if (to <= from) continue;
    const last = segs[segs.length - 1];
    if (last && last.category === g.category && last.to === from) last.to = to; else segs.push({ from, to, category: g.category });
  }
  return segs;
}
export const ageMinutes = (obsSec: number, nowMs: number): number => Math.max(0, Math.round((nowMs - obsSec * 1000) / 60000));
export const ageLabel = (min: number): string => (min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`);
export const inHg = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
export function cloudText(c: CloudLayer[]): string { return c.length ? c.map((l) => (l.baseFt === null ? l.cover : `${l.cover} ${l.baseFt.toLocaleString('en-US')} ft`)).join(', ') : 'Sky clear'; }
export function fmtTime(sec: number, tz: string): string {
  try { return new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }); } catch { return new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
}
export function describeTafGroup(g: TafGroup, tz: string): string {
  const wind = g.windKt === null ? '' : ` · wind ${g.windDir === null ? 'variable' : `${g.windDir}°`} ${g.windKt} kt${g.gustKt ? ` gusting ${g.gustKt}` : ''}`;
  return `${fmtTime(g.from, tz)}–${fmtTime(g.to, tz)}${g.change ? ` (${g.change}${g.probability ? ` ${g.probability}%` : ''})` : ''} · ${g.category ?? 'category unknown'}${wind} · visibility ${g.visibSm === null ? 'unknown' : `${g.visibSm} SM`} · ${cloudText(g.clouds)}${g.weather ? ` · ${g.weather}` : ''}`;
}
