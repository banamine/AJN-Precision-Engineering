// HTTP surface for source contracts:
//   GET /api/sources         -> one status line per layer (for diagnostics)
//   GET /api/local/media/*   -> serves files from AJN_LOCAL_MEDIA_DIR with Range support
import express from 'express';
import path from 'node:path';
import { runSources, type SourceJob } from './runner';
import { localFilesContract } from './localFiles';
import { archiveNewsContract, NEWS_NETWORKS } from './archiveNews';
import { ajnAudioContract } from './ajnAudio';
import { ajnMediaContract } from './ajnMedia';
import type { SourceResult } from './contract';


export function localMediaRoot(): string | null {
  const dir = process.env.AJN_LOCAL_MEDIA_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export function registerSourceRoutes(app: express.Express, extraJobs: () => SourceJob[] = () => []) {
  app.get('/api/sources', async (_req, res) => {
    const jobs: SourceJob[] = [];
    const root = localMediaRoot();
    if (root) jobs.push({ contract: localFilesContract, input: { root, guideId: 'local-files' } });
    if (_req.query.news !== '0') {
      for (const [network, channelId, channelName] of NEWS_NETWORKS) {
        jobs.push({ contract: archiveNewsContract, input: { network, channelId, channelName, guideId: 'cable-tv', rows: 10 } });
      }
    }
    for (const kind of ['hourly', 'segment'] as const) jobs.push({ contract: ajnAudioContract, input: { kind } });
    for (const feedId of ['Alex', 'WarRoom', 'SundayLive', 'AJNHourlyVideo', 'AJNHourlyAudio'] as const) jobs.push({ contract: ajnMediaContract, input: { feedId } });
    jobs.push(...extraJobs());
    const results: SourceResult[] = await runSources(jobs);
    const labels = [...jobs].sort((a, b) => a.contract.priority - b.contract.priority)
      .map((j: any) => j.input?.network ?? j.input?.kind ?? j.input?.feedId ?? j.input?.playlistId ?? j.contract.sourceClass);
    res.json({
      checkedAt: new Date().toISOString(),
      sources: results.map((r, i) => ({
        sourceClass: r.sourceClass,
        label: labels[i],
        status: r.status,
        programs: r.programs.length,
        rejected: r.rejected,
        durationMs: r.durationMs,
        error: r.error,
      })),
    });
  });

  app.get(/^\/api\/local\/media\/(.+)$/, (req, res) => {
    const root = localMediaRoot();
    if (!root) return res.status(404).json({ error: 'Local media is not configured (set AJN_LOCAL_MEDIA_DIR)' });
    const rel = decodeURIComponent((req.params as any)[0] as string);
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      return res.status(400).json({ error: 'Path escapes the local media folder' });
    }
    // sendFile handles Range (206), Content-Length and Accept-Ranges.
    res.sendFile(full, { dotfiles: 'deny' }, (err: any) => {
      if (err && !res.headersSent) res.status(err.statusCode === 404 ? 404 : 500).json({ error: 'Local file not available' });
    });
  });
}
