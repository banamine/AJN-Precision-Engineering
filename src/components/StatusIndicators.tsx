import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Clock, WifiOff, X, XCircle } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import { useArchiveStatus } from '../hooks/useArchiveStatus';
import { getLastArchiveProgressAt, subscribeArchiveProgress, ARCHIVE_PROGRESS_WINDOW_MS } from '../utils/archivePlaybackEvidence';
import { newsReadyStore, type NewsReadySnapshot } from '../utils/newsReadyStore';
import {
  announcementFor,
  describeArchiveStatus,
  describeNetworkStatus,
  describeNewsStatus,
  hasRecentArchiveProgress,
  type ServiceId,
  type ServiceIndicator,
  type StatusTone,
} from '../utils/serviceStatus';
import { NewsReadyReport } from './NewsReadyNotice';

const TONE_CLASS: Record<StatusTone, { pill: string; icon: string }> = {
  ok: { pill: 'border-emerald-600/50 bg-emerald-950/40 text-emerald-100', icon: 'text-emerald-400' },
  warn: { pill: 'border-amber-600/60 bg-amber-950/40 text-amber-100', icon: 'text-amber-400' },
  error: { pill: 'border-rose-600/60 bg-rose-950/50 text-rose-100', icon: 'text-rose-400' },
  neutral: { pill: 'border-neutral-700/80 bg-neutral-900/80 text-neutral-300', icon: 'text-neutral-400' },
};

const TONE_WORD: Record<StatusTone, string> = { ok: 'OK', warn: 'Warning', error: 'Problem', neutral: 'Info' };

/** Shape carries the state too, so colour is never the only signal. */
function ToneIcon({ indicator, className }: { indicator: ServiceIndicator; className: string }) {
  if (indicator.id === 'network') return <WifiOff aria-hidden="true" className={className} />;
  switch (indicator.tone) {
    case 'ok': return <CheckCircle2 aria-hidden="true" className={className} />;
    case 'warn': return <AlertTriangle aria-hidden="true" className={className} />;
    case 'error': return <XCircle aria-hidden="true" className={className} />;
    default: return <Clock aria-hidden="true" className={className} />;
  }
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}
const getOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const SERVER_NEWS: NewsReadySnapshot = { phase: 'checking', version: null, newShows: [], fetchedAt: null, refreshing: false, checkedAt: null };

export interface StatusIndicatorsViewProps {
  indicators: ServiceIndicator[];
  newsSnapshot: NewsReadySnapshot;
  onPlayProgram?: PlayProgramCallback;
  onNewsSeen: () => void;
  /** For static/test rendering only. */
  initialOpenId?: ServiceId | null;
}

/** Presentational row: no fetching, so it can be rendered in tests. */
export function StatusIndicatorsView({ indicators, newsSnapshot, onPlayProgram, onNewsSeen, initialOpenId = null }: StatusIndicatorsViewProps) {
  const uid = useId();
  const [openId, setOpenId] = useState<ServiceId | null>(initialOpenId);
  const [tipId, setTipId] = useState<ServiceId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<ServiceId, HTMLButtonElement | null>());
  const closeRefs = useRef(new Map<ServiceId, HTMLButtonElement | null>());
  const pointerTypeRef = useRef<string>('mouse');

  // An indicator that disappears (e.g. "Offline" after reconnecting) takes its report with it.
  useEffect(() => {
    if (openId && !indicators.some((i) => i.id === openId)) setOpenId(null);
    if (tipId && !indicators.some((i) => i.id === tipId)) setTipId(null);
  }, [indicators, openId, tipId]);

  const close = useCallback((returnFocus: boolean) => {
    setOpenId((current) => {
      if (current && returnFocus) window.setTimeout(() => triggerRefs.current.get(current)?.focus(), 0);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    // Keyboard and touch users land on the report's Close button.
    window.setTimeout(() => closeRefs.current.get(openId)?.focus({ preventScroll: true }), 0);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [openId, close]);

  // One polite live region for the whole row; first render is silent.
  const [announcement, setAnnouncement] = useState('');
  const lastLabels = useRef<Map<ServiceId, string> | null>(null);
  useEffect(() => {
    const next = new Map(indicators.map((i) => [i.id, i.label] as const));
    const prev = lastLabels.current;
    lastLabels.current = next;
    if (!prev) return;
    const changed = indicators.filter((i) => prev.get(i.id) !== i.label && i.tone !== 'neutral');
    if (changed.length) setAnnouncement(changed.map(announcementFor).join(' '));
  }, [indicators]);

  const crowded = indicators.some((i) => i.id === 'network');
  const phoneIconOnly = (ind: ServiceIndicator) => ind.tone === 'neutral' || (crowded && ind.id !== 'network');

  return (
    <div ref={rootRef} className="flex min-w-0 items-center gap-1.5" data-testid="status-indicators" role="group" aria-label="Service status">
      {indicators.map((ind) => {
        const tone = TONE_CLASS[ind.tone];
        const reportId = `${uid}-${ind.id}-report`;
        const tipDomId = `${uid}-${ind.id}-tip`;
        const headingId = `${uid}-${ind.id}-heading`;
        const isOpen = openId === ind.id;
        const showTip = tipId === ind.id && !isOpen;
        return (
          <div key={ind.id} className="relative shrink-0">
            <button
              type="button"
              ref={(el) => { triggerRefs.current.set(ind.id, el); }}
              data-testid={`status-indicator-${ind.id}`}
              data-tone={ind.tone}
              aria-label={`${ind.service} status: ${ind.label}${ind.count ? `, ${ind.count} new` : ''}. Show details.`}
              aria-expanded={isOpen}
              aria-controls={reportId}
              aria-describedby={showTip ? tipDomId : undefined}
              onPointerDown={(e) => { pointerTypeRef.current = e.pointerType; }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') setTipId(ind.id); }}
              onPointerLeave={() => setTipId((t) => (t === ind.id ? null : t))}
              onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setTipId(ind.id); }}
              onBlur={() => setTipId((t) => (t === ind.id ? null : t))}
              onClick={() => { setTipId(null); setOpenId((cur) => (cur === ind.id ? null : ind.id)); }}
              className={`flex h-8 min-w-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 touch-manipulation ${tone.pill}`}
            >
              <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {ind.pulseKey && (
                  <span key={ind.pulseKey} aria-hidden="true" className="ajn-status-pulse absolute inset-0 rounded-full bg-emerald-400/60" />
                )}
                <ToneIcon indicator={ind} className={`relative h-3.5 w-3.5 ${tone.icon}`} />
              </span>
              {/* <md: full label · md: icon only (room is taken by the nav) · lg: service name · xl+: full label.
                  On phones, "nothing to report" pills and pills crowded out by "Offline" drop to icon-only
                  (shape-coded icon + aria-label + tooltip/report) so the row never overflows. */}
              <span className={phoneIconOnly(ind) ? 'hidden sm:inline md:hidden xl:inline' : 'md:hidden xl:inline'}>{ind.label}</span>
              <span className="hidden lg:inline xl:hidden">{ind.shortLabel}</span>
              {ind.count ? (
                <span aria-hidden="true" className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">{ind.count}</span>
              ) : null}
            </button>

            {showTip && (
              <div
                id={tipDomId}
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-max max-w-[15rem] rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] leading-snug text-neutral-200 shadow-lg"
              >
                <span className="font-semibold">{ind.label}.</span> {ind.tooltip}
              </div>
            )}

            {isOpen && (
              <div
                id={reportId}
                role="dialog"
                aria-modal="false"
                aria-labelledby={headingId}
                data-testid={`status-report-${ind.id}`}
                className="fixed left-2 right-2 top-[3.75rem] z-50 max-h-[min(45vh,20rem)] overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950/95 p-3 text-xs text-neutral-200 shadow-xl backdrop-blur-md sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
              >
                <div className="flex items-start gap-2">
                  <ToneIcon indicator={ind} className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} />
                  <h2 id={headingId} className="min-w-0 flex-1 text-sm font-semibold text-neutral-100">
                    {ind.label}
                    <span className="sr-only"> ({TONE_WORD[ind.tone]})</span>
                  </h2>
                  <button
                    type="button"
                    ref={(el) => { closeRefs.current.set(ind.id, el); }}
                    onClick={() => close(true)}
                    className="-m-1 flex h-7 items-center gap-1 rounded px-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Close</span>
                  </button>
                </div>
                <ul className="mt-1.5 space-y-1 text-neutral-300">
                  {ind.detail.map((line) => <li key={line}>{line}</li>)}
                </ul>
                {ind.id === 'news' && (
                  <NewsReadyReport
                    snapshot={newsSnapshot}
                    onPlay={onPlayProgram}
                    onSeen={() => { onNewsSeen(); close(true); }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
}

/**
 * Compact, non-blocking service status for the top row. Replaces the old
 * auto-opening Archive banner and "Latest news ready" overlay: nothing here
 * opens without a click/tap, and nothing covers the player on its own.
 */
export function StatusIndicators({ onPlayProgram }: { onPlayProgram?: PlayProgramCallback }) {
  const archive = useArchiveStatus();
  const progressAt = useSyncExternalStore(subscribeArchiveProgress, getLastArchiveProgressAt, () => null);
  const news = useSyncExternalStore(newsReadyStore.subscribe, newsReadyStore.getSnapshot, () => SERVER_NEWS);
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate when progress evidence arrives and exactly when it goes stale, so
  // "Archive playing" can't linger after playback stops.
  useEffect(() => {
    const t = Date.now();
    setNow(t);
    if (!hasRecentArchiveProgress(t, progressAt)) return;
    const expiresIn = Math.max(0, (progressAt as number) + ARCHIVE_PROGRESS_WINDOW_MS - t) + 50;
    const timer = window.setTimeout(() => setNow(Date.now()), expiresIn);
    return () => window.clearTimeout(timer);
  }, [progressAt, archive.state, archive.phase]);

  const indicators = useMemo(() => {
    const list: ServiceIndicator[] = [
      describeNewsStatus(news),
      describeArchiveStatus({ phase: archive.phase, state: archive.state, since: archive.since, now, progressAt }),
    ];
    const network = describeNetworkStatus(online);
    if (network) list.push(network);
    return list;
  }, [news, archive.phase, archive.state, archive.since, now, progressAt, online]);

  return (
    <StatusIndicatorsView
      indicators={indicators}
      newsSnapshot={news}
      onPlayProgram={onPlayProgram}
      onNewsSeen={newsReadyStore.markSeen}
    />
  );
}
