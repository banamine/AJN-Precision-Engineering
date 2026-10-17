/* Which media can go through the Web Audio bridge (compressor + visualizer).
 * The browser only lets Web Audio read a cross-origin file when it was loaded
 * with CORS. Three ways a source qualifies:
 *  1. same-origin (our proxies: /api/archive/proxy, /api/ajn/proxy)
 *  2. a host that sends Access-Control-Allow-Origin (listed below)
 *  3. HLS played through hls.js — segments arrive by XHR (already CORS) and
 *     the element plays a same-origin MediaSource blob.
 * Anything else plays natively without the bridge, never silently. */
import podcastSources from "../data/podcastSources.json";
import liveRadioSources from "../data/liveRadioSources.json";
import Hls from "hls.js";

/** AJN file hosts that send no CORS headers: routed through /api/ajn/proxy. */
export const AJN_PROXY_HOSTS = ["archive.alexjoneslive.com", "www.alexjoneslive.com"];
/** Hosts verified to send Access-Control-Allow-Origin: * (live AJN streams). */
export const CORS_HOSTS = ["stream.alexjones.media"];

export function bridgeSrc(src: string | undefined): string | undefined {
  if (!src) return src;
  try {
    const u = new URL(src);
    // Pluto playlists refuse other sites; segments/keys don't. Playlists only.
    if (u.protocol === "https:" && (u.hostname === "jmp2.uk" || u.hostname === "pluto.tv" || u.hostname.endsWith(".pluto.tv"))) {
      return `/api/hls/playlist?url=${encodeURIComponent(src)}`;
    }
    if (u.protocol === "https:" && !u.port && AJN_PROXY_HOSTS.includes(u.hostname)) {
      return `/api/ajn/proxy?url=${encodeURIComponent(src)}`;
    }
  } catch { /* relative URL */ }
  return src;
}

/** Marker appended once a CORS-mode load failed: the same file is then played natively (no signal meter). */
export const NO_METER_MARK = "#nometer";
/** Marker on a podcast URL the server already resolved (tracker chain walked): never resolved twice. */
export const RESOLVED_MARK = "#resolved";
const METER_PODCAST_PREFIXES = ((podcastSources as { sources: Array<{ id: string; enabled: boolean; corsVerified?: boolean }> }).sources)
  .filter((p) => p.enabled && p.corsVerified).map((p) => `pod-${p.id}-`);
/** True for podcast programs whose enclosure chain was verified to allow CORS-mode playback. */
export function podcastAllowsMeter(programId?: string): boolean {
  return Boolean(programId) && METER_PODCAST_PREFIXES.some((x) => programId!.startsWith(x));
}

/** Live radio stations whose stream was verified to send CORS headers in a real browser (corsVerified=true AND verifiedAt set).
 *  Their program ids are "<station id>:live:*". Only these may load in CORS mode, so the signal meter can read them. */
const METER_RADIO_PREFIXES = ((liveRadioSources as { stations: Array<{ id: string; enabled?: boolean; verifiedAt?: string; corsVerified?: boolean }> }).stations)
  .filter((s) => s.enabled && s.verifiedAt && s.corsVerified).map((s) => `${s.id}:`);
/** Bulk-directory stations are not in the client bundle (the 2,000+ list is server-only). The Radio panel registers a station here
 *  when the server says it sends CORS headers (corsVerified), just before playing it. Same rule as the static list: https only,
 *  and a failed CORS load retries without CORS (NO_METER_MARK), so a wrong flag can cost the visualizer but never the sound. */
const DYNAMIC_METER_RADIO = new Set<string>();
/** The same list is kept in the browser so a station restored after a reload still gets CORS mode (and the visualizer)
 *  without a second tap. Newest last, capped, and read defensively: a missing or corrupt value just means "empty". */
export const METER_RADIO_STORAGE_KEY = 'ajn.meter.radio.v1';
const METER_RADIO_STORED_MAX = 300;
const STATION_ID = /^radio:[A-Za-z0-9._-]+$/;
export interface MeterStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function defaultMeterStorage(): MeterStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function readStoredMeterIds(storage: MeterStorage | null = defaultMeterStorage()): string[] {
  if (!storage) return [];
  try {
    const v: unknown = JSON.parse(storage.getItem(METER_RADIO_STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && STATION_ID.test(x)).slice(-METER_RADIO_STORED_MAX) : [];
  } catch { return []; }
}
export function writeStoredMeterIds(ids: readonly string[], storage: MeterStorage | null = defaultMeterStorage()): void {
  if (!storage) return;
  try { storage.setItem(METER_RADIO_STORAGE_KEY, JSON.stringify(ids.slice(-METER_RADIO_STORED_MAX))); } catch { /* storage full or blocked: memory-only for this visit */ }
}
for (const id of readStoredMeterIds()) DYNAMIC_METER_RADIO.add(`${id}:`);
export function registerLiveRadioMeter(stationId: string, storage: MeterStorage | null = defaultMeterStorage()): void {
  if (!STATION_ID.test(stationId)) return;
  const had = DYNAMIC_METER_RADIO.has(`${stationId}:`);
  DYNAMIC_METER_RADIO.add(`${stationId}:`);
  if (had) return;
  writeStoredMeterIds([...readStoredMeterIds(storage).filter((x) => x !== stationId), stationId], storage);
}
export function liveRadioAllowsMeter(programId?: string): boolean {
  if (!programId) return false;
  if (METER_RADIO_PREFIXES.some((x) => programId.startsWith(x))) return true;
  const end = programId.indexOf(":live:");
  return end > 0 && DYNAMIC_METER_RADIO.has(`${programId.slice(0, end)}:`);
}

export function corsModeFor(src: string | undefined, isHls: boolean, programId?: string): "anonymous" | undefined {
  if (!src) return undefined;
  if (src.includes(NO_METER_MARK)) return undefined;
  if (podcastAllowsMeter(programId) && src.startsWith("https://")) return "anonymous";
  if (liveRadioAllowsMeter(programId) && src.startsWith("https://")) return "anonymous";
  if (src.startsWith("/")) return "anonymous";
  if (isHls && Hls.isSupported()) return "anonymous";
  try { if (CORS_HOSTS.includes(new URL(src).hostname)) return "anonymous"; } catch { /* ignore */ }
  return undefined;
}
