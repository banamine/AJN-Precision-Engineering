import type { CubeArticle } from './adapter';

export type CubeArchiveState = 'ok' | 'degraded' | 'down' | 'unreachable_from_here' | 'unknown';
export type CubePlaybackResult = 'started' | 'no-media' | 'archive-offline' | 'stale';

export interface CubePlaybackBridgeDeps {
  getArchiveState: () => CubeArchiveState | Promise<CubeArchiveState>;
  stopExistingPlayback: () => void;
  startExistingPlayback: (article: CubeArticle) => void;
  onNoMedia: (article: CubeArticle) => void;
  onArchiveOffline: (article: CubeArticle) => void;
}

function isArchiveHosted(source: string): boolean {
  try {
    const url = new URL(source, 'https://ajn.invalid');
    if (/(^|\.)archive\.org$/i.test(url.hostname)) return true;
    for (const key of ['url', 'src', 'source']) {
      const value = url.searchParams.get(key);
      if (!value) continue;
      try {
        if (/(^|\.)archive\.org$/i.test(new URL(value, url.origin).hostname)) return true;
      } catch { /* invalid nested URL is not an Archive source */ }
    }
  } catch { /* malformed source is not considered Archive-hosted here */ }
  return false;
}

export function createPlaybackBridge(deps: CubePlaybackBridgeDeps) {
  let requestId = 0;
  let activeCubePlayback = false;

  return {
    async requestPlayback(article: CubeArticle): Promise<CubePlaybackResult> {
      const current = ++requestId;
      const media = article.mediaReference;
      if (!media || !media.src.trim()) {
        deps.onNoMedia(article);
        return 'no-media';
      }

      const archiveHosted = isArchiveHosted(media.src);
      const archiveState = await deps.getArchiveState();
      if (current !== requestId) return 'stale';
      if (archiveHosted && (archiveState === 'down' || archiveState === 'unreachable_from_here')) {
        deps.onArchiveOffline(article);
        return 'archive-offline';
      }

      // The existing player owns source replacement and HLS teardown; this callback
      // pauses its current element before the normal App playback entry point starts.
      deps.stopExistingPlayback();
      if (current !== requestId) return 'stale';
      deps.startExistingPlayback(article);
      activeCubePlayback = true;
      return 'started';
    },
    pause(): void {
      requestId += 1;
      if (activeCubePlayback) deps.stopExistingPlayback();
      activeCubePlayback = false;
    },
    invalidate(): void {
      requestId += 1;
      activeCubePlayback = false;
    },
    getRequestId(): number { return requestId; },
  };
}
