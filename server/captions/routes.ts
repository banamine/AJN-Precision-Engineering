// Mounts /api/captions/plan and /api/captions/slice. Restricted to the TV News channels in NEWS_NETWORKS.
import type { Express, Request, Response } from 'express';
import { NEWS_NETWORKS } from '../sources/archiveNews';
import { createCaptionService, type CaptionService } from './captionService';

export function allowedNewsNetworks(): Set<string> {
  return new Set(NEWS_NETWORKS.flatMap(([codes]) => codes.split('|').map((c) => c.trim().replace(/^TV-/i, '').toUpperCase()).filter(Boolean)));
}

function clientSignal(res: Response): AbortSignal {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  return ac.signal;
}

function send(res: Response, result: { ok: true; value: unknown } | { ok: false; status: number; error: string; retryAfter?: number }) {
  res.set('Cache-Control', 'no-store');
  if (result.ok) return res.json((result as { ok: true; value: unknown }).value);
  const r = result as { ok: false; status: number; error: string; retryAfter?: number };
  if (r.status === 499) return res.end();
  if (r.status === 429 && r.retryAfter) res.set('Retry-After', String(r.retryAfter));
  return res.status(r.status).json(r.retryAfter ? { error: r.error, retryAfter: r.retryAfter } : { error: r.error });
}

export function registerCaptionRoutes(app: Express, service: CaptionService = createCaptionService({ allowedNetworks: allowedNewsNetworks() })) {
  app.get('/api/captions/plan', async (req: Request, res: Response) => {
    send(res, await service.plan(String(req.query.id ?? ''), clientSignal(res)));
  });
  app.get('/api/captions/slice', async (req: Request, res: Response) => {
    const start = /^\d+$/.test(String(req.query.start ?? '')) ? Number(req.query.start) : NaN;
    send(res, await service.slice(String(req.query.id ?? ''), String(req.query.src ?? ''), start, clientSignal(res)));
  });
  return service;
}
