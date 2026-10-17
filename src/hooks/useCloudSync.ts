import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { FavoriteMedia } from '../utils/mediaFavorites';
import type { HistoryEntry } from '../utils/historyStore';
import { mergeFavorites, mergeHistory } from '../sync/syncMerge';
import { syncOnce, type CloudBackend } from '../sync/syncEngine';
import { emptyLocalState, loadLocalState, loadSyncSettings, saveLocalState, saveSyncSettings, type SyncLocalState, type SyncSettings } from '../sync/syncState';
import type { SyncUser } from '../sync/cloudBackend';

export type SyncPhase = 'signed-out' | 'signing-in' | 'idle' | 'syncing' | 'error';
export interface CloudSyncApi {
  phase: SyncPhase; user: SyncUser | null; error: string | null; lastSyncAt: number; settings: SyncSettings; notice: string | null;
  signIn: () => void; signOut: () => void; syncNow: () => void; setHistorySync: (on: boolean) => void;
  noteFavoriteRemoved: (id: string) => void; noteHistoryRemoved: (id: string) => void; noteHistoryCleared: () => void;
}
interface Params { favorites: FavoriteMedia[]; setFavorites: Dispatch<SetStateAction<FavoriteMedia[]>>; history: HistoryEntry[]; setHistory: Dispatch<SetStateAction<HistoryEntry[]>> }

const WAS_SIGNED_IN_KEY = 'ajn.sync.enabled';
const FAV_DEBOUNCE_MS = 3_000;
const HIST_DEBOUNCE_MS = 60_000; // resume position changes every few seconds; don't spend Firestore reads on each one
const MIN_FOCUS_SYNC_MS = 60_000;
const sameIds = (a: Array<{ id: string }>, b: Array<{ id: string }>, f: (x: any) => number) => a.length === b.length && a.every((x, i) => x.id === b[i].id && f(x) === f(b[i]));

export function useCloudSync({ favorites, setFavorites, history, setHistory }: Params): CloudSyncApi {
  const [phase, setPhase] = useState<SyncPhase>('signed-out');
  const [user, setUser] = useState<SyncUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<SyncSettings>(() => loadSyncSettings());
  const [lastSyncAt, setLastSyncAt] = useState(() => loadLocalState().lastSyncAt);

  const favRef = useRef(favorites); favRef.current = favorites;
  const histRef = useRef(history); histRef.current = history;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const localRef = useRef<SyncLocalState>(typeof window === 'undefined' ? emptyLocalState() : loadLocalState());
  const backendRef = useRef<CloudBackend | null>(null);
  const runningRef = useRef(false); const againRef = useRef(false); const lastRunRef = useRef(0);
  const appliedFav = useRef<FavoriteMedia[] | null>(null); const appliedHist = useRef<HistoryEntry[] | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const persist = useCallback((patch: Partial<SyncLocalState>) => { localRef.current = { ...localRef.current, ...patch }; saveLocalState(localRef.current); }, []);

  const runSync = useCallback(async () => {
    const backend = backendRef.current; if (!backend) return;
    if (runningRef.current) { againRef.current = true; return; }
    runningRef.current = true; setPhase('syncing'); setError(null);
    try {
      const now = Date.now();
      const syncHistory = settingsRef.current.historySync;
      const res = await syncOnce(backend, { favorites: favRef.current, favTombs: localRef.current.favTombs, history: histRef.current, histTombs: localRef.current.histTombs, historyClearedAt: localRef.current.historyClearedAt, syncHistory }, now);
      // Apply against the CURRENT state (it may have changed during the round trip) using the same remote snapshot; no-ops return the same reference.
      const latestFavTombs = { ...localRef.current.favTombs, ...res.favTombs };
      setFavorites((cur) => { const m = mergeFavorites(cur, latestFavTombs, res.snapshot.remoteFavs, Date.now()).list; if (sameIds(cur, m, (x) => x.savedAt)) return cur; appliedFav.current = m; return m; });
      let histPatch: Partial<SyncLocalState> = {};
      if (syncHistory && res.snapshot.remoteHist) {
        const snap = res.snapshot;
        setHistory((cur) => { const m = mergeHistory(cur, localRef.current.histTombs, res.historyClearedAt, snap.remoteHist!, snap.remoteClearedAt, Date.now()).entries; if (sameIds(cur, m, (x) => x.updatedAt ?? x.playedAt)) return cur; appliedHist.current = m; return m; });
        histPatch = { histTombs: res.histTombs, historyClearedAt: res.historyClearedAt };
      }
      persist({ favTombs: latestFavTombs, ...histPatch, lastSyncAt: now });
      setLastSyncAt(now); setPhase('idle');
      setNotice(res.stats.favOverLimit ? 'You have more favorites in the cloud than this app keeps (200). The newest 200 are shown.' : null);
    } catch (e) {
      const { describeAuthError } = await import('../sync/cloudBackend');
      setError(describeAuthError(e)); setPhase('error');
    } finally {
      runningRef.current = false; lastRunRef.current = Date.now();
      if (againRef.current) { againRef.current = false; window.setTimeout(() => void runSync(), 1500); }
    }
  }, [persist, setFavorites, setHistory]);

  const attach = useCallback(async () => {
    const { getFirebase, createFirestoreBackend, watchAuth } = await import('../sync/cloudBackend');
    const { db } = getFirebase();
    unsubRef.current?.();
    unsubRef.current = watchAuth((u) => {
      if (!u) { backendRef.current = null; setUser(null); setPhase((p) => (p === 'signing-in' ? p : 'signed-out')); return; } // the initial null must not cancel an in-flight sign-in
      backendRef.current = createFirestoreBackend(db, u.uid);
      setUser({ uid: u.uid, email: u.email, name: u.displayName }); setPhase('idle');
      try { localStorage.setItem(WAS_SIGNED_IN_KEY, '1'); } catch { /* ignore */ }
      void runSync();
    }, (e) => { setError(String((e as Error)?.message ?? e)); setPhase('error'); });
  }, [runSync]);

  // Restore an earlier sign-in. People who never signed in never load the Firebase SDK.
  useEffect(() => {
    let was = false; try { was = localStorage.getItem(WAS_SIGNED_IN_KEY) === '1'; } catch { /* ignore */ }
    if (was) void attach().catch((e) => { setError(String((e as Error)?.message ?? e)); setPhase('error'); });
    return () => unsubRef.current?.();
  }, [attach]);

  const signIn = useCallback(async () => {
    setError(null); setPhase('signing-in');
    try {
      const { signInWithGoogle, currentUser, describeAuthError } = await import('../sync/cloudBackend');
      await attach();
      try { await signInWithGoogle(); } catch (e) { setError(describeAuthError(e)); setPhase(currentUser() ? 'idle' : 'signed-out'); }
    } catch (e) { setError(String((e as Error)?.message ?? e)); setPhase('error'); }
  }, [attach]);

  const signOut = useCallback(async () => {
    try { const { signOutUser } = await import('../sync/cloudBackend'); await signOutUser(); } catch { /* already signed out */ }
    try { localStorage.removeItem(WAS_SIGNED_IN_KEY); } catch { /* ignore */ }
    backendRef.current = null; setUser(null); setPhase('signed-out'); setError(null);
  }, []);

  // Local changes → debounced sync. Favorites are quick; History is slow on purpose (see HIST_DEBOUNCE_MS). Our own applied merge results are skipped.
  useEffect(() => {
    if (!user || favorites === appliedFav.current) return;
    const t = window.setTimeout(() => void runSync(), FAV_DEBOUNCE_MS); return () => window.clearTimeout(t);
  }, [favorites, user, runSync]);
  useEffect(() => {
    if (!user || !settings.historySync || history === appliedHist.current) return;
    const t = window.setTimeout(() => void runSync(), HIST_DEBOUNCE_MS); return () => window.clearTimeout(t);
  }, [history, user, settings.historySync, runSync]);
  useEffect(() => {
    if (!user) return;
    const on = () => { if (document.visibilityState === 'visible' && Date.now() - lastRunRef.current > MIN_FOCUS_SYNC_MS) void runSync(); };
    document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on);
  }, [user, runSync]);

  const setHistorySync = useCallback((on: boolean) => { const s = { historySync: on }; setSettings(s); saveSyncSettings(s); settingsRef.current = s; if (on && backendRef.current) void runSync(); }, [runSync]);
  const noteFavoriteRemoved = useCallback((id: string) => persist({ favTombs: { ...localRef.current.favTombs, [id]: Date.now() } }), [persist]);
  const noteHistoryRemoved = useCallback((id: string) => persist({ histTombs: { ...localRef.current.histTombs, [id]: Date.now() } }), [persist]);
  const noteHistoryCleared = useCallback(() => { persist({ historyClearedAt: Date.now(), histTombs: {} }); if (backendRef.current && settingsRef.current.historySync) window.setTimeout(() => void runSync(), 300); }, [persist, runSync]);

  return { phase, user, error, lastSyncAt, settings, notice, signIn: () => void signIn(), signOut: () => void signOut(), syncNow: () => void runSync(), setHistorySync, noteFavoriteRemoved, noteHistoryRemoved, noteHistoryCleared };
}
