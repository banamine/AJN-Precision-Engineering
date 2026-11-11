/* Radio page drawers: how open each lower section is, remembered across reloads. Pure helpers (no DOM).
 * Stages: closed (header bar only) / preview (the newest 4) / full (everything). */
export type DrawerStage = 'closed' | 'preview' | 'full';
export interface RadioDrawerPrefs { findOpen: boolean; listenStage: DrawerStage; fullShowsStage: DrawerStage; briefingStage: DrawerStage }
export const RADIO_DRAWERS_KEY = 'ajn.radio.drawers.v1';
export const PREVIEW_COUNT = 4;
export const DEFAULT_DRAWER_PREFS: RadioDrawerPrefs = { findOpen: false, listenStage: 'preview', fullShowsStage: 'preview', briefingStage: 'preview' };

const STAGES: readonly DrawerStage[] = ['closed', 'preview', 'full'];
const isStage = (v: unknown): v is DrawerStage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);
const defaultStore = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

export function readRadioDrawerPrefs(storage: Pick<Storage, 'getItem'> | null | undefined = defaultStore()): RadioDrawerPrefs {
  try {
    const raw = storage?.getItem(RADIO_DRAWERS_KEY); if (!raw) return { ...DEFAULT_DRAWER_PREFS };
    const v = JSON.parse(raw) as Partial<Record<keyof RadioDrawerPrefs, unknown>>;
    const d = DEFAULT_DRAWER_PREFS;
    return {
      findOpen: typeof v.findOpen === 'boolean' ? v.findOpen : d.findOpen,
      listenStage: isStage(v.listenStage) ? v.listenStage : d.listenStage,
      fullShowsStage: isStage(v.fullShowsStage) ? v.fullShowsStage : d.fullShowsStage,
      briefingStage: isStage(v.briefingStage) ? v.briefingStage : d.briefingStage,
    };
  } catch { return { ...DEFAULT_DRAWER_PREFS }; }
}
export function writeRadioDrawerPrefs(prefs: RadioDrawerPrefs, storage: Pick<Storage, 'setItem'> | null | undefined = defaultStore()): void {
  try { storage?.setItem(RADIO_DRAWERS_KEY, JSON.stringify(prefs)); } catch { /* private mode: layout just isn't remembered */ }
}

/** The header toggle: closed -> preview, anything open -> closed. */
export const toggleDrawer = (s: DrawerStage): DrawerStage => (s === 'closed' ? 'preview' : 'closed');
/** The size switch: preview <-> full (a closed drawer opens to preview). */
export const nextDrawerStage = (s: DrawerStage): DrawerStage => (s === 'preview' ? 'full' : 'preview');
export const stageLimit = (s: DrawerStage, full: number): number => (s === 'closed' ? 0 : s === 'preview' ? Math.min(PREVIEW_COUNT, full) : full);

/** Most recently played item that has a real saved position (>= 5 s) and matches one of `entries` (audio id, or "<id>:video"). */
export function latestResumable<E extends { id: string }>(
  recent: readonly { id: string; programId?: string; progressSeconds: number; updatedAt: number }[], entries: readonly E[],
): { entry: E; seconds: number; video: boolean } | null {
  const byId = new Map<string, E>(entries.map((e) => [e.id, e]));
  let best: { entry: E; seconds: number; video: boolean; at: number } | null = null;
  for (const r of recent) {
    if (!(r.progressSeconds >= 5)) continue;
    const key = r.programId ?? r.id; const video = key.endsWith(':video'); const entry = byId.get(video ? key.slice(0, -6) : key);
    if (entry && (!best || r.updatedAt > best.at)) best = { entry, seconds: r.progressSeconds, video, at: r.updatedAt };
  }
  return best ? { entry: best.entry, seconds: best.seconds, video: best.video } : null;
}
