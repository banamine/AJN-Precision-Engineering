/* Preset banks for everything that is not live radio: Archive Music, Live Concerts, Podcasts.
 * Five keys per bank, stored on this device only. Live radio keeps its own v2 store (radioPresets.ts) untouched,
 * so nothing a viewer already saved is migrated, rewritten or lost. Pure functions + injectable storage. */
import { useEffect, useState } from 'react';

export const AUDIO_PRESETS_KEY = 'ajn.audio.presets.v3';
export const AUDIO_PRESETS_EVENT = 'ajn-audio-presets-changed';
export const AUDIO_BANKS = ['music', 'concerts', 'podcasts'] as const;
export type AudioBank = (typeof AUDIO_BANKS)[number];
export const AUDIO_SLOTS = [1, 2, 3, 4, 5] as const;
export type AudioSlot = (typeof AUDIO_SLOTS)[number];

export interface AudioPreset {
  bank: AudioBank;
  slot: AudioSlot;
  /** Catalog id (music channel, concert id or podcast episode id): used to re-play with its full queue. */
  itemId: string;
  title: string;
  subtitle?: string;
  /** Archive path / URL of the first (or only) file: the fallback when the catalog is not loaded. */
  src: string;
  channelId?: string;
  guideId?: string;
  programId?: string;
}
export type AudioPresetInput = Omit<AudioPreset, 'slot' | 'bank'>;
export type AudioPresetBanks = Record<AudioBank, Partial<Record<AudioSlot, AudioPreset>>>;
export interface AudioPresetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isAudioBank = (v: unknown): v is AudioBank => (AUDIO_BANKS as readonly unknown[]).includes(v);
export const isAudioSlot = (v: unknown): v is AudioSlot => typeof v === 'number' && (AUDIO_SLOTS as readonly number[]).includes(v);
const empty = (): AudioPresetBanks => ({ music: {}, concerts: {}, podcasts: {} });
function store(s?: AudioPresetStorage): AudioPresetStorage | null {
  try { return s ?? (typeof window === 'undefined' ? null : window.localStorage); } catch { return null; }
}

function clean(slot: AudioSlot, o: Record<string, unknown>): AudioPreset | null {
  if (!isAudioBank(o.bank) || !isStr(o.itemId) || !isStr(o.title) || !isStr(o.src)) return null;
  return {
    bank: o.bank, slot, itemId: o.itemId, title: o.title, src: o.src,
    subtitle: isStr(o.subtitle) ? o.subtitle : undefined,
    channelId: isStr(o.channelId) ? o.channelId : undefined,
    guideId: isStr(o.guideId) ? o.guideId : undefined,
    programId: isStr(o.programId) ? o.programId : undefined,
  };
}

export function loadAudioPresets(storage?: AudioPresetStorage): AudioPresetBanks {
  const out = empty();
  const s = store(storage);
  if (!s) return out;
  try {
    const raw: unknown = JSON.parse(s.getItem(AUDIO_PRESETS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return out;
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (!isAudioBank(o.bank) || !isAudioSlot(o.slot) || out[o.bank][o.slot]) continue;
      const p = clean(o.slot, o);
      if (p) out[o.bank][o.slot] = p;
    }
  } catch { /* unreadable storage: start empty */ }
  return out;
}

function write(banks: AudioPresetBanks, storage?: AudioPresetStorage): void {
  const list = AUDIO_BANKS.flatMap((b) => AUDIO_SLOTS.map((n) => banks[b][n]).filter((p): p is AudioPreset => Boolean(p)));
  try { store(storage)?.setItem(AUDIO_PRESETS_KEY, JSON.stringify(list)); } catch { /* storage blocked: presets last for this visit only */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUDIO_PRESETS_EVENT)); } catch { /* no window */ }
}

/** Saves into one bank's slot. A bad bank, slot or item is refused and nothing changes. */
export function saveAudioPreset(bank: string, slot: number, input: AudioPresetInput, storage?: AudioPresetStorage): { saved: boolean; presets: AudioPresetBanks } {
  const current = loadAudioPresets(storage);
  if (!isAudioBank(bank) || !isAudioSlot(slot)) return { saved: false, presets: current };
  const p = clean(slot, { ...input, bank });
  if (!p) return { saved: false, presets: current };
  const next: AudioPresetBanks = { ...current, [bank]: { ...current[bank], [slot]: p } };
  write(next, storage);
  return { saved: true, presets: next };
}

export function clearAudioPreset(bank: string, slot: number, storage?: AudioPresetStorage): AudioPresetBanks {
  const current = loadAudioPresets(storage);
  if (!isAudioBank(bank) || !isAudioSlot(slot) || !current[bank][slot]) return current;
  const bankMap = { ...current[bank] };
  delete bankMap[slot];
  const next: AudioPresetBanks = { ...current, [bank]: bankMap };
  write(next, storage);
  return next;
}

export function useAudioPresets(): AudioPresetBanks {
  const [presets, setPresets] = useState<AudioPresetBanks>(() => loadAudioPresets());
  useEffect(() => {
    const sync = (): void => setPresets(loadAudioPresets());
    window.addEventListener(AUDIO_PRESETS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(AUDIO_PRESETS_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return presets;
}
