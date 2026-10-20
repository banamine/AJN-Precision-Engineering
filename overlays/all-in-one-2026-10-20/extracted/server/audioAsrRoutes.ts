import type { Express, Request, Response } from 'express';
import { audioAsrService, AudioAsrError, AUDIO_ASR_LABEL, type AudioAsrService } from './audioAsr';

function fail(res: Response, error: unknown) {
  const e = error instanceof AudioAsrError ? error : new AudioAsrError('asr_unavailable', 503, 'Machine transcript unavailable');
  if (e.retryAfter) res.setHeader('Retry-After', e.retryAfter);
  return res.status(e.status).json({ error: e.code, message: e.message, source: 'asr', label: AUDIO_ASR_LABEL });
}
function noStore(res: Response) { res.setHeader('Cache-Control', 'no-store'); }

export function registerAudioAsrRoutes(app: Express, service = audioAsrService) {
  app.get('/api/audio-asr/:identifier/plan', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const result = await service.plan(req.params.identifier);
      return res.status(200).json(result);
    } catch (error) { return fail(res, error); }
  });
  app.get('/api/audio-asr/:identifier/slice', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const result = await service.slice(req.params.identifier, req.query.t);
      return res.status(200).json(result);
    } catch (error) { return fail(res, error); }
  });
}
