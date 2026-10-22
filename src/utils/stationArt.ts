/* Station pictures + themes shared by every radio surface (directory, presets, group, dock, mini player, full player).
 * Whoever knows a station's logo (directory page, group fetch, preset) registers it here; the players read it back by station id.
 * Only real logos from the directory records are stored; nothing is invented. In memory + a small localStorage copy so a restored session keeps its picture. */
import { useSyncExternalStore } from 'react';
import { getStationTheme, type StationTheme } from './radioAccents';
import { loadRadioPresets } from './radioPresets';

const KEY = 'ajn.radio.art.v1';
const MAX = 120;
const art = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw: unknown = JSON.parse((typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null) ?? '{}');
    if (raw && typeof raw === 'object') for (const [id, url] of Object.entries(raw as Record<string, unknown>)) if (id.startsWith('radio:') && typeof url === 'string' && /^https:\/\//.test(url)) art.set(id, url);
  } catch { /* no storage: in-memory only */ }
}
function persist(): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...art.entries()].slice(-MAX)))); } catch { /* private mode / quota */ }
}

export const isRadioId = (id?: string | null): id is string => typeof id === 'string' && id.startsWith('radio:');

/** Remember the logos of stations just seen. Ignores entries without an https logo. One notification per batch. */
export function rememberStationArt(items: Array<{ id: string; logo?: string }>): void {
  hydrate();
  let changed = false;
  for (const it of items) {
    if (!isRadioId(it.id) || !it.logo || !/^https:\/\//.test(it.logo) || art.get(it.id) === it.logo) continue;
    art.delete(it.id); art.set(it.id, it.logo); changed = true; // re-insert = newest last
  }
  if (!changed) return;
  while (art.size > MAX) art.delete(art.keys().next().value as string);
  version += 1; persist();
  listeners.forEach((l) => l());
}

/** Logo for a station id: registry first, then the saved presets. */
export function getStationArt(id?: string | null): string | undefined {
  if (!isRadioId(id)) return undefined;
  hydrate();
  const known = art.get(id);
  if (known) return known;
  try { for (const p of Object.values(loadRadioPresets())) if (p?.channelId === id && p.logo) return p.logo; } catch { /* ignore */ }
  return undefined;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Theme (accent, themeColor, icon) for a playing radio station, or null when the id is not a radio station. */
export function useStationTheme(id?: string | null, name = ''): StationTheme | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  if (!isRadioId(id)) return null;
  return getStationTheme(id, name, getStationArt(id));
}
