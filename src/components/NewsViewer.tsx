import { useEffect, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';
import { NewsArticle } from '../types';

export interface NewsViewerProps {
  article: NewsArticle;
  onClose: () => void;
}

type ViewerMode = 'normal' | 'minimized';

export function NewsViewer({ article, onClose }: NewsViewerProps) {
  const [mode, setMode] = useState<ViewerMode>('normal');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement != null);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const root = document.getElementById('ajn-news-viewer');
    if (!root) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (root.requestFullscreen) {
        await root.requestFullscreen();
      }
    } catch (error) {
      console.warn('[AJN News] fullscreen request failed', error);
    }
  };

  if (mode === 'minimized' && !isFullscreen) {
    return (
      <aside
        id="ajn-news-viewer"
        aria-label="Minimized news story"
        className="fixed bottom-20 md:bottom-24 right-4 sm:right-6 z-50 flex w-[calc(100vw-2rem)] max-w-md items-center gap-3 rounded-2xl border border-neutral-700/80 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-md"
      >
        {article.imageUrl ? (
          <img
            src={article.imageUrl}
            alt=""
            className="h-11 w-14 shrink-0 rounded-lg object-cover border border-neutral-700"
          />
        ) : (
          <div className="h-11 w-14 shrink-0 rounded-lg border border-neutral-700 bg-neutral-800" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => setMode('normal')}
          className="min-w-0 flex-1 text-left"
          title="Restore news story"
        >
          <span className="block truncate text-[10px] font-mono uppercase tracking-wider text-sky-400">
            {article.feedName || 'News'}
          </span>
          <span className="block truncate text-xs font-semibold text-neutral-100">
            {article.title}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode('normal')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
          title="Restore"
          aria-label="Restore news story"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
          title="Close"
          aria-label="Close news story"
        >
          <X className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <div
      id="ajn-news-viewer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ajn-news-viewer-title"
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 sm:p-6 ${isFullscreen ? 'bg-neutral-950 p-0' : ''}`}
    >
      <article
        className={`relative flex w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl ${isFullscreen ? 'h-full max-w-none rounded-none border-0' : 'max-h-[calc(100vh-2rem)]'}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-mono uppercase tracking-widest text-sky-400">
              {article.feedName || article.category || 'News'}
            </div>
            <div className="truncate text-[11px] text-neutral-500">
              {article.published || 'Recently'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMode('minimized')}
              disabled={isFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Minimize"
              aria-label="Minimize"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
              title="Close"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto">
          {article.imageUrl && (
            <div className="aspect-[16/9] w-full bg-black">
              <img
                src={article.imageUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          <div className="space-y-4 p-5 sm:p-6">
            <h2
              id="ajn-news-viewer-title"
              className="max-w-3xl text-xl font-semibold leading-tight tracking-tight text-neutral-50 sm:text-2xl"
            >
              {article.title}
            </h2>

            <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
              {article.author || article.feedName || article.category || 'News'}
            </div>

            <p className="max-w-3xl text-sm leading-6 text-neutral-300 sm:text-base">
              {article.summary}
            </p>

            {article.link && (
              <a
                href={article.link}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs font-medium text-sky-400 transition hover:border-sky-500/40 hover:bg-neutral-800 hover:text-sky-300"
              >
                Read full story
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
