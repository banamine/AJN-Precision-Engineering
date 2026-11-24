/* The volume the listener chose on the docks, kept on this device only. Only a deliberate slider move is saved
 * (never fades, jingles or loudness changes), and it is re-applied once to each new player element. */
export const DOCK_VOLUME_KEY = 'ajn.dockVolume.v1';

export const clampVolume = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

/** null when nothing was ever saved, so the player's own default stays in charge. */
export function loadDockVolume(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): number | null {
  try {
    const raw = storage?.getItem(DOCK_VOLUME_KEY);
    if (raw === null || raw === undefined) return null;
    const n = Number(JSON.parse(raw)?.volume);
    return Number.isFinite(n) ? clampVolume(n) : null;
  } catch { return null; }
}
export function saveDockVolume(volume: number, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(DOCK_VOLUME_KEY, JSON.stringify({ version: 1, volume: clampVolume(volume) })); return true; } catch { return false; }
}

const restored = new WeakSet<HTMLMediaElement>();
/** Apply the saved volume to a player element, once per element. */
export function restoreDockVolume(media: HTMLMediaElement): void {
  if (restored.has(media)) return;
  restored.add(media);
  const v = loadDockVolume();
  if (v !== null && media.volume !== v) media.volume = v;
}
/** Slider handler: set the element and remember the choice. */
export function setDockVolume(media: HTMLMediaElement | null, volume: number): number {
  const v = clampVolume(volume);
  if (media) media.volume = v;
  saveDockVolume(v);
  return v;
}
