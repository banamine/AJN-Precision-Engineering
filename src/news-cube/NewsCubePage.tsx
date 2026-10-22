import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';
import { Box, ChevronLeft, ChevronRight, List, RotateCw, X } from 'lucide-react';
import { useArchiveStatus } from '../hooks/useArchiveStatus';
import { allocateFaces, filterByPublisher, type CubeArticle } from './adapter';
import { createThreeCubeRenderer, type CubeRendererFactory, type CubeRendererPort } from './cubeRenderer';
import { createPlaybackBridge, type CubeArchiveState } from './playbackBridge';
import { isDigestStale, useNewsCubeData } from './useNewsCubeData';

type PlaybackBridge = ReturnType<typeof createPlaybackBridge>;
interface NewsCubePageProps {
  fetcher?: typeof fetch;
  digestUrl?: string;
  refreshMs?: number;
  now?: () => number;
  rendererFactory?: CubeRendererFactory;
  playbackBridge?: PlaybackBridge;
  startExistingPlayback?: (article: CubeArticle) => void;
  stopExistingPlayback?: () => void;
  archiveStateOverride?: CubeArchiveState;
  reducedMotionOverride?: boolean;
}

const reduceMotionPreference = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function updatedLabel(value: string | null, now: number): string {
  const time = Date.parse(value ?? '');
  if (!Number.isFinite(time)) return 'Update time unavailable';
  const ageMs = Math.max(0, now - time);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function articleName(article: CubeArticle | null): string {
  return article?.title ?? 'Empty story slot';
}

export default function NewsCubePage({
  fetcher,
  digestUrl,
  refreshMs,
  now,
  rendererFactory = createThreeCubeRenderer,
  playbackBridge: playbackBridgeOverride,
  startExistingPlayback,
  stopExistingPlayback,
  archiveStateOverride,
  reducedMotionOverride,
}: NewsCubePageProps) {
  const data = useNewsCubeData({ fetcher, digestUrl, refreshMs, now });
  const archiveStatus = useArchiveStatus();
  const archiveState = archiveStateOverride ?? archiveStatus.state;
  const archiveStateRef = useRef<CubeArchiveState>(archiveState);
  archiveStateRef.current = archiveState;
  const starterRef = useRef(startExistingPlayback);
  starterRef.current = startExistingPlayback;
  const stopperRef = useRef(stopExistingPlayback);
  stopperRef.current = stopExistingPlayback;
  const [noMediaMessage, setNoMediaMessage] = useState(false);
  const [archiveOfflineMessage, setArchiveOfflineMessage] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<CubeArticle | null>(null);
  const [listView, setListView] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeFace, setActiveFace] = useState(0);
  const [interactionActive, setInteractionActive] = useState(false);
  const [publisherFilter, setPublisherFilter] = useState('');
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => (now ?? Date.now)());
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(reducedMotionOverride ?? reduceMotionPreference);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CubeRendererPort | null>(null);
  const rafRef = useRef<number | null>(null);
  const transitionRef = useRef<{ from: ReturnType<CubeRendererPort['getQuaternion']>; to: ReturnType<CubeRendererPort['getQuaternion']>; start: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const pointerDownAtRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const bridgeRef = useRef<PlaybackBridge | null>(null);
  const nowValue = now ?? Date.now;

  if (!bridgeRef.current) {
    bridgeRef.current = createPlaybackBridge({
      getArchiveState: () => archiveStateRef.current,
      stopExistingPlayback: () => stopperRef.current?.(),
      startExistingPlayback: (article) => starterRef.current?.(article),
      onNoMedia: () => setNoMediaMessage(true),
      onArchiveOffline: () => setArchiveOfflineMessage(true),
    });
  }
  const bridge = playbackBridgeOverride ?? bridgeRef.current;
  const filteredArticles = useMemo(
    () => filterByPublisher(data.snapshot?.articles ?? [], publisherFilter || null),
    [data.snapshot?.articles, publisherFilter],
  );
  const faces = useMemo(() => allocateFaces(filteredArticles), [filteredArticles]);
  const currentFace = faces[activeFace] ?? faces[4];
  const activeArticles = currentFace?.articles ?? [];

  useEffect(() => {
    if (reducedMotionOverride !== undefined) {
      setPrefersReducedMotion(reducedMotionOverride);
      if (reducedMotionOverride) setAutoRotate(false);
      return;
    }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const onChange = () => {
      setPrefersReducedMotion(media.matches);
      if (media.matches) setAutoRotate(false);
    };
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [reducedMotionOverride]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(nowValue()), 30_000);
    return () => window.clearInterval(timer);
  }, [nowValue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: CubeRendererPort;
    try {
      renderer = rendererFactory(canvas);
    } catch {
      setRendererError('3D view is unavailable in this browser. Use List view to browse headlines.');
      return;
    }
    rendererRef.current = renderer;
    for (const face of faces) renderer.setFaceArticles(face.faceIndex, face.articles);
    renderer.prepareFace(activeFace);
    renderer.setQuaternion(renderer.targetQuaternion(activeFace));
    renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
    renderer.render();
    const resize = () => {
      renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
      renderer.render();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    window.addEventListener('resize', resize);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      transitionRef.current = null;
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      renderer.dispose();
      rendererRef.current = null;
    };
    // Renderer is one-per-mount. Its factory is an injectable test seam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listView, rendererFactory]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    for (const face of faces) renderer.setFaceArticles(face.faceIndex, face.articles);
    renderer.prepareFace(activeFace);
    renderer.render();
  }, [faces, activeFace]);

  const closeCard = useCallback(() => {
    setSelectedArticle(null);
    data.setInteracting(false);
  }, [data.setInteracting]);

  const beginCubeNavigation = useCallback((faceIndex: number, dragDelta?: { x: number; y: number }) => {
    const targetFace = (faceIndex + 6) % 6;
    bridge.pause();
    setNoMediaMessage(false);
    setArchiveOfflineMessage(false);
    closeCard();
    data.setInteracting(true);
    setInteractionActive(true);
    setActiveFace(targetFace);
    const renderer = rendererRef.current;
    if (!renderer) {
      data.setInteracting(false);
      setInteractionActive(false);
      return;
    }
    renderer.prepareFace(targetFace);
    renderer.setFaceArticles(targetFace, faces[targetFace]?.articles ?? []);
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (dragDelta) {
      renderer.rotateBy(dragDelta.x * 0.008, dragDelta.y * 0.008);
      renderer.render();
      return;
    }
    const from = renderer.getQuaternion();
    const to = renderer.targetQuaternion(targetFace);
    if (prefersReducedMotion) {
      renderer.setQuaternion(to);
      renderer.render();
      transitionRef.current = null;
      data.setInteracting(false);
      setInteractionActive(false);
      return;
    }
    transitionRef.current = { from, to, start: performance.now() };
    const tick = (time: number) => {
      const active = transitionRef.current;
      if (!active || !rendererRef.current) {
        rafRef.current = null;
        return;
      }
      const progress = Math.min(1, (time - active.start) / 360);
      const eased = progress * progress * (3 - 2 * progress);
      const current = active.from.clone().slerp(active.to, eased);
      renderer.setQuaternion(current);
      renderer.render();
      if (progress < 1) rafRef.current = window.requestAnimationFrame(tick);
      else {
        transitionRef.current = null;
        rafRef.current = null;
        data.setInteracting(false);
        setInteractionActive(false);
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, [bridge, closeCard, data.setInteracting, faces, prefersReducedMotion]);

  useEffect(() => {
    if (!autoRotate || prefersReducedMotion || interactionActive || selectedArticle) return;
    const timer = window.setInterval(() => beginCubeNavigation(activeFace + 1), 5_000);
    return () => window.clearInterval(timer);
  }, [activeFace, autoRotate, beginCubeNavigation, interactionActive, prefersReducedMotion, selectedArticle]);

  useEffect(() => () => bridge.invalidate(), [bridge]);

  const openArticle = useCallback((article: CubeArticle | null) => {
    if (!article) return;
    setSelectedArticle(article);
    setNoMediaMessage(!article.mediaReference);
    setArchiveOfflineMessage(false);
    setInteractionActive(true);
    data.setInteracting(true);
  }, [data.setInteracting]);

  const onCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    pointerDownAtRef.current = { x: event.clientX, y: event.clientY };
    dragRef.current = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setInteractionActive(true);
    data.setInteracting(true);
  };
  const onCanvasPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved) return;
    beginCubeNavigation(activeFace, { x: dx, y: dy });
  };
  const onCanvasPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const start = pointerDownAtRef.current;
    dragRef.current = null;
    pointerDownAtRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    data.setInteracting(false);
    setInteractionActive(false);
    if (drag?.moved) {
      suppressClickRef.current = true;
      beginCubeNavigation(rendererRef.current?.nearestFace() ?? activeFace);
      return;
    }
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) {
      const pick = rendererRef.current?.pick(event.clientX, event.clientY);
      if (pick && pick.faceIndex === activeFace) openArticle(faces[pick.faceIndex]?.articles[pick.slotIndex] ?? null);
    }
  };
  const onCanvasClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const pick = rendererRef.current?.pick(event.clientX, event.clientY);
    if (pick && pick.faceIndex === activeFace) openArticle(faces[pick.faceIndex]?.articles[pick.slotIndex] ?? null);
  };
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); beginCubeNavigation(activeFace - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); beginCubeNavigation(activeFace + 1); }
    else if (event.key === 'Enter') { event.preventDefault(); openArticle(activeArticles.find(Boolean) ?? null); }
    else if (event.key === 'Escape') { event.preventDefault(); closeCard(); }
  };
  const requestArticlePlayback = async () => {
    if (!selectedArticle) return;
    await bridge.requestPlayback(selectedArticle);
  };
  const publisherOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const article of data.snapshot?.articles ?? []) names.set(article.publisherId, article.publisherName);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.snapshot?.articles]);
  const dropped = data.snapshot?.dropped;

  return (
    <section className="w-full space-y-5" style={{ overflowWrap: 'anywhere' }} aria-labelledby="news-cube-title" data-testid="news-cube-page">
      <header className="flex flex-col gap-4 border-b border-neutral-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sky-300">
            <Box className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">Vault · Headlines</p>
          </div>
          <h1 id="news-cube-title" className="mt-1 text-2xl font-bold tracking-tight text-white">NEWS CUBE</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">Latest Matching · recent headlines and source links from the Daily News Digest.</p>
          <p className="mt-2 text-xs text-neutral-400" data-testid="news-cube-updated">
            {updatedLabel(data.snapshot?.lastUpdated ?? null, clock)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="news-cube-publisher">Filter by publisher</label>
          <select
            id="news-cube-publisher"
            value={publisherFilter}
            onChange={(event) => setPublisherFilter(event.target.value)}
            className="min-h-11 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            data-testid="publisher-filter"
          >
            <option value="">All publishers</option>
            {publisherOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { setListView((value) => !value); closeCard(); }}
            aria-pressed={listView}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-100 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            data-testid="list-view-toggle"
          >
            <List className="h-4 w-4" aria-hidden="true" /> {listView ? 'Cube view' : 'List view'}
          </button>
          {!listView && (
            <button
              type="button"
              aria-pressed={autoRotate && !prefersReducedMotion}
              disabled={prefersReducedMotion}
              onClick={() => setAutoRotate((value) => !value)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title={prefersReducedMotion ? 'Auto-rotate is off for reduced motion' : 'Auto-rotate (off by default)'}
              data-testid="auto-rotate-toggle"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" /> Auto-rotate
            </button>
          )}
        </div>
      </header>

      {isDigestStale(data.snapshot?.lastUpdated ?? null, clock) && data.snapshot && (
        <p role="status" className="rounded-lg border border-amber-700/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-100" data-testid="feed-stale">
          Feed looks stale. The last digest update is more than 36 hours old or has no usable update time.
        </p>
      )}
      {data.hasNewStories && (
        <button type="button" onClick={data.applyNewStories} className="rounded-full border border-sky-400/70 bg-sky-950/70 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" data-testid="new-stories-pill">
          New stories available · apply update
        </button>
      )}
      {data.error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-700/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-100" data-testid="digest-error">
          <span>{data.snapshot ? `Refresh failed (${data.error}); showing the last digest loaded.` : `Could not load the Daily News Digest (${data.error}).`}</span>
          <button type="button" onClick={() => void data.refresh()} className="min-h-11 rounded-md border border-rose-500/70 px-3 font-semibold hover:bg-rose-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">Retry</button>
        </div>
      )}
      {data.loading && !data.snapshot && <p role="status" className="text-sm text-neutral-400">Loading the Daily News Digest…</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.8fr)]">
        {!listView && (
          <div className="space-y-3" data-testid="cube-view">
            <div className="relative mx-auto w-full max-w-[660px] overflow-hidden rounded-2xl border border-neutral-800 bg-[#090d14] shadow-2xl">
              <canvas
                ref={canvasRef}
                aria-label={`${currentFace?.faceLabel ?? 'Face 1'} cube. Use left and right arrows to rotate; Enter opens the first article on this face.`}
                role="application"
                tabIndex={0}
                className="block aspect-square w-full touch-none outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-sky-400"
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerUp}
                onClick={onCanvasClick}
                onKeyDown={onCanvasKeyDown}
                data-testid="news-cube-canvas"
              />
              {rendererError && (
                <p role="alert" className="absolute inset-x-4 bottom-4 rounded-lg bg-neutral-950/95 p-3 text-sm text-amber-100">{rendererError}</p>
              )}
              <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                <button type="button" onClick={() => beginCubeNavigation(activeFace - 1)} aria-label="Previous cube face" className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-600/80 bg-neutral-950/85 text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" data-testid="previous-face"><ChevronLeft /></button>
                <span className="rounded-full border border-neutral-700 bg-neutral-950/85 px-3 py-1.5 text-xs font-medium text-neutral-100" data-testid="face-label">{currentFace?.faceLabel ?? 'Face 1'}</span>
                <button type="button" onClick={() => beginCubeNavigation(activeFace + 1)} aria-label="Next cube face" className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-600/80 bg-neutral-950/85 text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" data-testid="next-face"><ChevronRight /></button>
              </div>
            </div>
            <nav className="flex flex-wrap justify-center gap-2" aria-label="Cube faces">
              {faces.map((face) => (
                <button
                  key={face.faceIndex}
                  type="button"
                  aria-current={activeFace === face.faceIndex ? 'true' : undefined}
                  onClick={() => beginCubeNavigation(face.faceIndex)}
                  className={`min-h-10 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${activeFace === face.faceIndex ? 'border-sky-400 bg-sky-950/70 text-sky-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}
                >
                  {face.faceLabel}
                </button>
              ))}
            </nav>
          </div>
        )}

        {listView && (
          <section className="space-y-3 xl:col-span-2" aria-label="All 36 News Cube slots" data-testid="list-view">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {faces.flatMap((face) => face.articles.map((article, slotIndex) => {
                const absoluteIndex = face.faceIndex * 6 + slotIndex;
                return article ? (
                  <a
                    key={`${face.faceIndex}-${slotIndex}`}
                    href={article.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group min-h-32 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4 transition hover:border-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    data-testid={`cube-slot-${absoluteIndex}`}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">{face.faceLabel} · Slot {slotIndex + 1}</span>
                    <span className="mt-2 block font-semibold leading-snug text-neutral-100 group-hover:text-white">{article.title}</span>
                    <span className="mt-2 block text-xs text-neutral-400">{article.publisherName}</span>
                    <span className="mt-2 block text-sm leading-relaxed text-neutral-300">{article.summary}</span>
                    <span className="mt-3 block text-xs text-sky-300">Open source ↗</span>
                  </a>
                ) : (
                  <div key={`${face.faceIndex}-${slotIndex}`} className="min-h-32 rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-4 text-neutral-500" data-testid={`cube-slot-${absoluteIndex}`}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider">{face.faceLabel} · Slot {slotIndex + 1}</span>
                    <p className="mt-3 text-sm">No article in this slot.</p>
                  </div>
                );
              }))}
            </div>
          </section>
        )}

        {!listView && selectedArticle && (
          <aside role="dialog" aria-modal="true" aria-labelledby="cube-detail-title" className="rounded-2xl border border-sky-900/70 bg-neutral-900/85 p-5 shadow-xl" data-testid="detail-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">{selectedArticle.publisherName}</p>
                <h2 id="cube-detail-title" className="mt-2 text-xl font-bold leading-snug text-white">{selectedArticle.title}</h2>
              </div>
              <button type="button" onClick={closeCard} aria-label="Close article details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" data-testid="detail-close"><X /></button>
            </div>
            <p className="mt-3 text-xs text-neutral-400">{selectedArticle.publishedAt ? new Date(selectedArticle.publishedAt).toLocaleString() : 'Time unavailable'}</p>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">{selectedArticle.summary || 'No summary provided by the source.'}</p>
            <a href={selectedArticle.canonicalUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-sky-700 px-4 text-sm font-semibold text-sky-200 hover:bg-sky-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              Open source ↗
            </a>
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-sm text-neutral-300">
              {archiveOfflineMessage ? (
                <p role="status" data-testid="archive-offline-message">Archive is offline. Playback was not attempted.</p>
              ) : noMediaMessage ? (
                <p data-testid="no-media-message">No audio/video for this story.</p>
              ) : (
                <button type="button" onClick={() => void requestArticlePlayback()} className="min-h-11 rounded-md border border-neutral-700 px-3 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Request playback</button>
              )}
            </div>
          </aside>
        )}
      </div>

      {!data.loading && !data.error && filteredArticles.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400" data-testid="empty-state">No matching headlines are available in the current digest.</p>
      )}
      <details className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-xs text-neutral-400" data-testid="digest-quality">
        <summary className="cursor-pointer font-medium text-neutral-300">Digest quality and exclusions</summary>
        {dropped ? (
          <p className="mt-2">Excluded: no date {dropped.noDate}; outside 48 hours {dropped.tooOld}; fallback patterns {dropped.fake}; duplicates {dropped.duplicate}; invalid items {dropped.invalid}. Source counts: {data.snapshot?.storiesCount ?? 'unreported'} stories and {data.snapshot?.rssArticlesCount ?? 'unreported'} RSS articles.</p>
        ) : <p className="mt-2">No digest has been loaded yet.</p>}
        <p className="mt-2">Article text is held in memory for this page only. No client cache or server-side purge is used.</p>
      </details>
    </section>
  );
}
