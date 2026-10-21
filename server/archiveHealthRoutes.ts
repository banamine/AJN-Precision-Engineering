import type { Express, Request, Response } from 'express';
import type { ArchiveHealth } from './archiveHealth.js';

export function addArchiveStateToHealth<T extends Record<string, unknown>>(
  healthPayload: T,
  archiveState: string,
): T & { archive: string } {
  return { ...healthPayload, archive: archiveState };
}

export function registerArchiveHealthRoutes(
  app: Express,
  health: ArchiveHealth,
  getHealthPayload: () => Record<string, unknown>,
): void {
  app.get('/api/archive/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(health.getStatus());
  });
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(addArchiveStateToHealth(getHealthPayload(), health.getStatus().state));
  });
}
