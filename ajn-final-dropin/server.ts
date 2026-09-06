import { patchServer } from './server-patch.js';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { searchTVNews, getChannelSchedule } from './channels.js';
import { buildChannelFromSearch } from './archive-discovery';
import {
  getAllGuides,
  getGuideById,
  getChannelsByGuide,
  getChannelById,
  getChannelSources,
  addChannelSource,
  getAllPlaylists,
  getPlaylistById,
  syncPlaylist,
  getScheduleForGuide,
  ingestM3uPlaylist,
} from './guideRegistry';

// NOTE: deliberately no fileURLToPath(import.meta.url) / __filename / __dirname
// here. That construct is ESM-only and evaluates to `undefined` once esbuild
// bundles this file to CJS for production (dist/server.cjs), which crashes
// Node on startup. Path resolution below uses process.cwd() instead, which works
// identically in both dev and the bundled CJS production build.

const app = express();
const PORT = 3000;

app.use(express.json());

interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  retriedRequests: number;
  failedRequests: number;
  cacheHits: number;
  lastUpstreamLatencyMs: number;
  activeStreams: number;
}

const stats: ProxyStats = {
  totalRequests: 0,
  successfulRequests: 0,
  retriedRequests: 0,
  failedRequests: 0,
  cacheHits: 0,
  lastUpstreamLatencyMs: 0,
  activeStreams: 0,
};

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ajn-precision-engineering-proxy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    stats,
  });
});

app.post('/api/health', (req: Request, res: Response) => {
  console.log('[CLIENT ERROR]', req.body);
  res.json({ received: true });
});

// ── Dual-Guide & Channel Endpoints ────────────────────────────────────────

// GET /api/guides — returns all registered guides (video: Cable TV, audio: Audio & Podcasts)
app.get('/api/guides', (_req: Request, res: Response) => {
  const guides = getAllGuides();
  res.json({ guides, total: guides.length });
});

// GET /api/guides/:guideId — returns specific guide by id
app.get('/api/guides/:guideId', (req: Request, res: Response) => {
  const guide = getGuideById(req.params.guideId);
  if (!guide) {
    return res.status(404).json({ error: `Guide not found: ${req.params.guideId}` });
  }
  res.json(guide);
});

// GET /api/channels?guide=:guideId — returns normalized channels for guide or all
app.get('/api/channels', (req: Request, res: Response) => {
  const guideId = req.query.guide as string | undefined;
  const channels = getChannelsByGuide(guideId);
  res.json({
    guideId: guideId || 'all',
    total: channels.length,
    channels,
  });
});

// GET /api/channels/:channelId — returns single channel with sources
app.get('/api/channels/:channelId', (req: Request, res: Response) => {
  const channel = getChannelById(req.params.channelId);
  if (!channel) {
    return res.status(404).json({ error: `Channel not found: ${req.params.channelId}` });
  }
  res.json(channel);
});

// GET /api/channels/:channelId/sources — returns sources list for channel
app.get('/api/channels/:channelId/sources', (req: Request, res: Response) => {
  const sources = getChannelSources(req.params.channelId);
  res.json({
    channelId: req.params.channelId,
    total: sources.length,
    sources,
  });
});

// POST /api/channels/:channelId/sources — adds/updates a source for a channel
app.post('/api/channels/:channelId/sources', (req: Request, res: Response) => {
  const { channelId } = req.params;
  const { url, protocol, priority, enabled, metadata } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Source URL is required' });
  }

  const created = addChannelSource(channelId, {
    url,
    protocol,
    priority,
    enabled,
    metadata,
  });

  res.status(201).json({
    message: 'Channel source added successfully',
    source: created,
  });
});

// ── Schedule & EPG Endpoints ──────────────────────────────────────────────

// GET /api/schedule?guide=:guideId — returns 24h programming schedule for guide
app.get('/api/schedule', async (req: Request, res: Response) => {
  const guideId = (req.query.guide as string) || 'cable-tv';
  try {
    const channels = await getScheduleForGuide(guideId);
    res.json({
      guideId,
      channels,
      generatedAt: new Date().toISOString(),
      source: 'archive.org-live',
    });
  } catch (err: any) {
    console.error(`[Schedule] Schedule generation failed for guide ${guideId}:`, err?.message || err);
    res.status(500).json({ error: 'Failed to generate schedule data', channels: [] });
  }
});

// ── Playlist & M3U Ingestion Endpoints ─────────────────────────────────────

// GET /api/playlists — lists all managed playlists (News, TV Shows, Movies, Audio)
app.get('/api/playlists', (_req: Request, res: Response) => {
  const playlists = getAllPlaylists();
  res.json({ playlists, total: playlists.length });
});

// GET /api/playlists/:playlistId — returns single playlist detail
app.get('/api/playlists/:playlistId', (req: Request, res: Response) => {
  const playlist = getPlaylistById(req.params.playlistId);
  if (!playlist) {
    return res.status(404).json({ error: `Playlist not found: ${req.params.playlistId}` });
  }
  res.json(playlist);
});

// POST /api/playlists/:playlistId/sync — syncs/re-ingests the playlist M3U
app.post('/api/playlists/:playlistId/sync', (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const { customM3u } = req.body;

  const result = syncPlaylist(playlistId, customM3u);
  if (!result.success) {
    return res.status(400).json({
      error: `Failed to sync playlist ${playlistId}`,
      playlist: result.playlist,
    });
  }

  res.json({
    message: `Playlist ${playlistId} synchronized successfully`,
    playlist: result.playlist,
    ingestedCount: result.count,
  });
});

patchServer(app);

app.get('/api/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  const network = (req.query.network as string) || 'FOXNEWSW';
  const rows = req.query.rows ? parseInt(req.query.rows as string, 10) : 24;

  try {
    const result = await searchTVNews({
      network,
      query: query.trim() ? query.trim() : undefined,
      rows: Math.min(rows, 50),
    });
    res.json({
      query,
      network,
      total: result.total,
      items: result.items,
      safeEndDate: result.safeEndDate,
    });
  } catch (err: any) {
    console.error('[Search API Error]', err);
    res.status(500).json({ error: err?.message || 'Search failed', items: [], total: 0 });
  }
});

app.post('/api/watchdog/heartbeat', (req: Request, res: Response) => {
  console.log('[WATCHDOG HEARTBEAT]', req.body);
  res.json({ acknowledged: true, ts: Date.now() });
});

function validateArchivePath(rawPath: string): { valid: boolean; error?: string; cleanPath?: string } {
  if (!rawPath || typeof rawPath !== 'string') {
    return { valid: false, error: 'Path is required' };
  }
  if (!rawPath.startsWith('/')) {
    return { valid: false, error: 'Path must begin with a forward slash (/)' };
  }
  if (rawPath.includes('..') || rawPath.includes('\\')) {
    return { valid: false, error: 'Directory traversal sequences are forbidden' };
  }
  if (/^https?:\/\//i.test(rawPath) || rawPath.includes('://')) {
    return { valid: false, error: 'Embedded schemes/hosts are forbidden' };
  }
  return { valid: true, cleanPath: rawPath };
}

const ARCHIVE_BASE_URL = 'https://archive.org';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const RETRYABLE_STATUSES = [503, 429, 502, 504];

// Cap every response to this many bytes
const MAX_CHUNK_BYTES = 2 * 1024 * 1024; // 2MB per response

/**
 * Parses a Range header and returns the actual [start, end] byte range to serve.
 */
function resolveRequestedRange(rangeHeader: string | undefined): { start: number; end: number | null } {
  if (!rangeHeader) {
    return { start: 0, end: MAX_CHUNK_BYTES - 1 };
  }
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) {
    return { start: 0, end: MAX_CHUNK_BYTES - 1 };
  }
  const start = parseInt(match[1], 10);
  const requestedEnd = match[2] ? parseInt(match[2], 10) : null;

  if (requestedEnd === null) {
    return { start, end: start + MAX_CHUNK_BYTES - 1 };
  }

  const clampedEnd = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1);
  return { start, end: clampedEnd };
}

app.get('/api/archive/proxy', async (req: Request, res: Response) => {
  stats.totalRequests++;
  const rawPath = (req.query.path as string) || '';

  const validation = validateArchivePath(rawPath);
  if (!validation.valid || !validation.cleanPath) {
    stats.failedRequests++;
    return res.status(400).json({
      error: 'Invalid path parameter',
      details: validation.error,
    });
  }

  const upstreamUrl = `${ARCHIVE_BASE_URL}${validation.cleanPath}`;
  const { start, end } = resolveRequestedRange(req.headers.range);
  const upstreamRangeHeader = `bytes=${start}-${end}`;

  console.log(
    '[PROXY HIT]', req.method, req.originalUrl,
    '| Client Range:', req.headers.range || 'none',
    '| Upstream Range (clamped):', upstreamRangeHeader,
    '| Origin:', req.headers.origin || 'none'
  );

  const requestHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: '*/*',
    Range: upstreamRangeHeader,
    Connection: 'close',
  };

  let attempt = 0;
  let lastError: Error | null = null;
  const startTime = Date.now();

  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  while (attempt < MAX_RETRIES) {
    if (clientDisconnected || res.writableEnded) {
      break;
    }

    attempt++;
    const abortController = new AbortController();
    const fetchTimeout = setTimeout(() => abortController.abort(), 12000);

    const onClientClose = () => {
      abortController.abort();
    };
    req.once('close', onClientClose);

    try {
      const response = await fetch(upstreamUrl, {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'follow',
        signal: abortController.signal,
      });

      clearTimeout(fetchTimeout);
      req.removeListener('close', onClientClose);

      if (RETRYABLE_STATUSES.includes(response.status)) {
        stats.retriedRequests++;
        if (attempt < MAX_RETRIES && !clientDisconnected) {
          const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.warn(`[Archive Proxy] Upstream status ${response.status} for ${validation.cleanPath}. Retrying attempt ${attempt + 1}/${MAX_RETRIES} in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        lastError = new Error(`Upstream returned ${response.status} on all ${MAX_RETRIES} attempts`);
        break;
      }

      stats.lastUpstreamLatencyMs = Date.now() - startTime;

      // A media Range request must be answered with a real partial response.
      // Never turn an upstream 200/full-body response into a fake 206; that
      // produces a byte-range/header mismatch that browsers report as
      // MEDIA_ELEMENT_ERROR / format error.
      if (response.status !== 206) {
        lastError = new Error(`Archive.org returned HTTP ${response.status} for ranged media request`);
        stats.retriedRequests++;
        if (attempt < MAX_RETRIES && !clientDisconnected) {
          const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.warn(`[Archive Proxy] Expected 206 for ${validation.cleanPath}, received ${response.status}. Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }

      const contentType = response.headers.get('content-type') || '';
      if (/^(text\/html|application\/json|text\/plain)\b/i.test(contentType)) {
        lastError = new Error(`Archive.org returned non-media content-type ${contentType}`);
        stats.failedRequests++;
        return res.status(502).json({
          error: 'Archive.org returned a non-media response',
          contentType,
        });
      }

      stats.successfulRequests++;
      res.status(206);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('X-AJN-Proxy-Attempts', attempt.toString());
      res.setHeader('Accept-Ranges', 'bytes');

      res.setHeader('Content-Type', contentType || 'video/mp4');

      const upstreamContentRange = response.headers.get('content-range');
      if (upstreamContentRange) {
        res.setHeader('Content-Range', upstreamContentRange);
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (!response.body) {
        return res.end();
      }

      stats.activeStreams++;
      const reader = response.body.getReader();

      req.on('close', () => {
        reader.cancel().catch(() => {});
        stats.activeStreams = Math.max(0, stats.activeStreams - 1);
      });

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              stats.activeStreams = Math.max(0, stats.activeStreams - 1);
              break;
            }
            const canContinue = res.write(Buffer.from(value));
            if (!canContinue) {
              await new Promise<void>((resolve) => res.once('drain', resolve));
            }
          }
        } catch (_streamErr) {
          stats.activeStreams = Math.max(0, stats.activeStreams - 1);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream interrupted' });
          } else {
            res.end();
          }
        }
      };

      return pump();
    } catch (err: any) {
      clearTimeout(fetchTimeout);
      req.removeListener('close', onClientClose);

      if (clientDisconnected || res.writableEnded) {
        // Client navigated away or cancelled the range request, ignore
        break;
      }

      lastError = err;
      stats.retriedRequests++;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        const errMsg = err.cause?.message ? `${err.message} (${err.cause.message})` : err.message;
        console.warn(`[Archive Proxy] Network error fetching ${upstreamUrl}: ${errMsg}. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  stats.failedRequests++;
  return res.status(502).json({
    error: 'Failed to retrieve media from upstream after maximum retries',
    attempts: MAX_RETRIES,
    details: lastError?.message || 'Upstream error',
  });
});

app.get('/api/archive/metadata', async (req: Request, res: Response) => {
  const rawPath = (req.query.path as string) || '';
  const validation = validateArchivePath(rawPath);
  if (!validation.valid || !validation.cleanPath) {
    return res.status(400).json({ error: validation.error });
  }

  const upstreamUrl = `${ARCHIVE_BASE_URL}${validation.cleanPath}`;
  try {
    const headRes = await fetch(upstreamUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'AJN-Precision-Engineering-Proxy/1.0' },
    });

    return res.json({
      status: headRes.status,
      ok: headRes.ok,
      contentType: headRes.headers.get('content-type'),
      contentLength: headRes.headers.get('content-length'),
      acceptRanges: headRes.headers.get('accept-ranges'),
      proxyUrl: `/api/archive/proxy?path=${encodeURIComponent(validation.cleanPath)}`,
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AJN] Integrated Server running at http://0.0.0.0:${PORT}`);
    
    // Asynchronously build the Archive channel in the background on startup
    buildChannelFromSearch('collection:SciFi_Horror', 'archive-scifi', 'Sci-Fi Horror Archive')
      .then(channel => console.log(`[AJN] Built Archive channel: ${channel.name} with ${channel.playlist.length} assets`))
      .catch(err => console.error(`[AJN] Failed to build Archive channel:`, err));
      
    // Restore News dynamic M3U ingestion to fix regression
    getChannelSchedule().then(schedule => {
      let m3u = "#EXTM3U\n";
      schedule.forEach(ch => {
         if (ch.programs && ch.programs.length > 0) {
            const prog = ch.programs[0];
            const logo = `https://archive.org/services/img/${prog.archivePath.split('/')[2]}`;
            m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="News",${ch.name}\n`;
            m3u += `${prog.archivePath}\n`;
         }
      });
      console.log("[AJN] Dynamically built News M3U:\n" + m3u);
      const playlist = getPlaylistById('playlist-news');
      if (playlist) {
         playlist.rawM3u = m3u;
         ingestM3uPlaylist(playlist, m3u);
         console.log("[AJN] Reingested News M3U successfully.");
      }
    }).catch(err => console.error(`[AJN] Failed to build News M3U:`, err));
  });
}

startServer();
