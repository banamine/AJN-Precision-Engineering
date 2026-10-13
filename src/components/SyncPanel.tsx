import { Cloud, CloudOff, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { CloudSyncApi } from '../hooks/useCloudSync';

const ago = (ts: number) => { if (!ts) return 'never'; const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; };

/** Sign-in + sync controls. Favorites sync whenever you are signed in; History sync is a separate switch and starts OFF. */
export function SyncPanel({ sync }: { sync: CloudSyncApi }) {
  const signedIn = !!sync.user;
  return (
    <section aria-label="Cloud sync" data-testid="sync-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-neutral-200">
          {signedIn ? <Cloud className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /> : <CloudOff className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />}
          <span className="min-w-0 truncate" data-testid="sync-status">
            {signedIn ? `Signed in as ${sync.user!.email ?? sync.user!.name ?? 'your Google account'} · ${sync.phase === 'syncing' ? 'syncing…' : sync.phase === 'error' ? 'sync problem' : `synced ${ago(sync.lastSyncAt)}`}`
              : sync.phase === 'signing-in' ? 'Signing in…' : 'Not signed in — Favorites and History stay on this device only.'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {signedIn ? (<>
            <button type="button" data-testid="sync-now" onClick={sync.syncNow} disabled={sync.phase === 'syncing'} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${sync.phase === 'syncing' ? 'animate-spin' : ''}`} aria-hidden="true" /> Sync now</button>
            <button type="button" data-testid="sync-signout" onClick={sync.signOut} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out</button>
          </>) : (
            <button type="button" data-testid="sync-signin" onClick={sync.signIn} disabled={sync.phase === 'signing-in'} className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-50"><LogIn className="h-3.5 w-3.5" aria-hidden="true" /> Sign in with Google to sync</button>
          )}
        </div>
      </div>
      {signedIn && (
        <div className="mt-3 space-y-1.5 border-t border-neutral-800 pt-3 text-xs text-neutral-400">
          <p>Favorites sync automatically while you are signed in.</p>
          <label className="flex cursor-pointer items-center gap-2 text-neutral-200">
            <input type="checkbox" data-testid="sync-history-toggle" checked={sync.settings.historySync} onChange={(e) => sync.setHistorySync(e.target.checked)} className="h-4 w-4 accent-sky-500" />
            Also sync my watch History across devices <span className="text-neutral-500">(off by default)</span>
          </label>
          <p className="text-neutral-500">Newest change wins per item. "Clear history" clears it on every device that syncs.</p>
        </div>
      )}
      {sync.notice && <p className="mt-2 text-xs text-amber-300" data-testid="sync-notice">{sync.notice}</p>}
      {sync.error && <p role="alert" data-testid="sync-error" className="mt-2 text-xs text-red-300">{sync.error}</p>}
    </section>
  );
}
