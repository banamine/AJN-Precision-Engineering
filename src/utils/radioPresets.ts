/* Five car-radio style preset slots for live radio. Stored on this device only.
 * Pure functions + injectable storage so they can be tested without a browser. */
import { useEffect, useState } from 'react';

export const RADIO_PRESETS_KEY = 'ajn.radio.presets.v2';
export const RADIO_PRESETS_EVENT = 'ajn-radio-presets-changed';
export const RADIO_PRESET_SLOTS = [1, 2, 3, 4, 5] as const;
export type RadioPresetSlot = (typeof RADIO_PRESET_SLOTS)[number];

export interface RadioPreset {
  slot: RadioPresetSlot;
  /** Always a live-radio id: "radio:..." */
  channelId: string;
  title: string;
  subtitle?: string;
  /** Stable station number, e.g. 683 (shown as #683). */
  number?: number;
  logo?: string;
  /** Stream URL used to start playback. */
  src: string;
  programId?: string;
  guideId?: string;
  /** Kept so a preset start still enables the audio visualizer for CORS-verified streams. */
  corsVerified?: boolean;
}
export type RadioPresetMap = Partial<Record<RadioPresetSlot, RadioPreset>>;
export type RadioPresetInput = Omit<RadioPreset, 'slot'>;
export interface PresetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isPresetSlot = (v: unknown): v is RadioPresetSlot => typeof v === 'number' && (RADIO_PRESET_SLOTS as readonly number[]).includes(v);

function store(s?: PresetStorage): PresetStorage | null {
  try { return s ?? (typeof window === 'undefined' ? null : window.localStorage); } catch { return null; }
}

function clean(slot: RadioPresetSlot, o: Record<string, unknown>): RadioPreset | null {
  if (!isStr(o.channelId) || !o.channelId.startsWith('radio:') || !isStr(o.src) || !isStr(o.title)) return null;
  const number = typeof o.number === 'number' && Number.isInteger(o.number) && o.number > 0 ? o.number : undefined;
  return {
    slot,
    channelId: o.channelId,
    title: o.title,
    subtitle: isStr(o.subtitle) ? o.subtitle : undefined,
    number,
    logo: isStr(o.logo) ? o.logo : undefined,
    src: o.src,
    programId: isStr(o.programId) ? o.programId : undefined,
    guideId: isStr(o.guideId) ? o.guideId : undefined,
    corsVerified: o.corsVerified === true ? true : undefined,
  };
}

/** Starting presets for a device that has never saved any: the two AJN live stations, then Classic Hits 109. Used only when nothing is stored; once the listener saves or clears a slot, their own choices win. */
const FACTORY = (slot: RadioPresetSlot, channelId: string, title: string, src: string): RadioPreset => ({ slot, channelId, title, src, corsVerified: true });
export const DEFAULT_RADIO_PRESETS: RadioPresetMap = {
  1: FACTORY(1, 'radio:ajn-alex-jones-show', 'AJN Alex Jones', 'https://stream.alexjones.media/alexjonesshow'),
  2: FACTORY(2, 'radio:ajn-infowars-live-aac', 'AJN Infowars', 'https://stream.alexjones.media/stream/7/'),
  3: FACTORY(3, 'radio:ch109-original', '109 Original', 'https://broadcast.classichits109.com/70s'),
  4: FACTORY(4, 'radio:ch109-classic-rock-109', '109 Classic Rock', 'https://broadcast.classichits109.com/cr109'),
  5: FACTORY(5, 'radio:ch109-warm-109', '109 Warm', 'https://broadcast.classichits109.com/warm109'),
};

export function loadRadioPresets(storage?: PresetStorage): RadioPresetMap {
  const s = store(storage);
  if (!s) return {};
  try {
    const stored = s.getItem(RADIO_PRESETS_KEY);
    if (stored === null) return { ...DEFAULT_RADIO_PRESETS };
    const raw: unknown = JSON.parse(stored);
    if (!Array.isArray(raw)) return {};
    const out: RadioPresetMap = {};
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (!isPresetSlot(o.slot) || out[o.slot]) continue;
      const p = clean(o.slot, o);
      if (p) out[o.slot] = p;
    }
    return out;
  } catch { return {}; }
}

function write(map: RadioPresetMap, storage?: PresetStorage): void {
  const list = RADIO_PRESET_SLOTS.map((n) => map[n]).filter((p): p is RadioPreset => Boolean(p));
  try { store(storage)?.setItem(RADIO_PRESETS_KEY, JSON.stringify(list)); } catch { /* storage full or blocked: presets last for this visit only */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(RADIO_PRESETS_EVENT)); } catch { /* no window */ }
}

/** Saves a station into a slot. Anything that is not a live-radio station, or a bad slot, is refused and nothing changes. */
export function saveRadioPreset(slot: number, input: RadioPresetInput, storage?: PresetStorage): { saved: boolean; presets: RadioPresetMap } {
  const current = loadRadioPresets(storage);
  if (!isPresetSlot(slot)) return { saved: false, presets: current };
  const p = clean(slot, input as unknown as Record<string, unknown>);
  if (!p) return { saved: false, presets: current };
  const next: RadioPresetMap = { ...current, [slot]: p };
  write(next, storage);
  return { saved: true, presets: next };
}

export function clearRadioPreset(slot: number, storage?: PresetStorage): RadioPresetMap {
  const current = loadRadioPresets(storage);
  if (!isPresetSlot(slot) || !current[slot]) return current;
  const next: RadioPresetMap = { ...current };
  delete next[slot];
  write(next, storage);
  return next;
}

/** Live presets; every component that shows the bar reads and writes the same list. */
export function useRadioPresets(): RadioPresetMap {
  const [presets, setPresets] = useState<RadioPresetMap>(() => loadRadioPresets());
  useEffect(() => {
    const sync = (): void => setPresets(loadRadioPresets());
    window.addEventListener(RADIO_PRESETS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(RADIO_PRESETS_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return presets;
}

/** The saved presets in key order (1 to 5), skipping empty keys. */
export function listRadioPresets(map: RadioPresetMap = loadRadioPresets()): RadioPreset[] {
  return RADIO_PRESET_SLOTS.map((n) => map[n]).filter((p): p is RadioPreset => Boolean(p));
}

/** The station before (-1) or after (+1) the one playing, wrapping at both ends. Nothing playing: first (+1) or last (-1). Used by the tuning knob and the dock Prev/Next so both step the same way. */
export function pickAdjacentStation<T extends { channelId: string }>(list: T[], currentId: string | undefined, dir: 1 | -1): T | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex((x) => x.channelId === currentId);
  return list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
}
