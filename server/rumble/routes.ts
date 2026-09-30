import type { Express, Request, Response } from "express";
import { RUMBLE_BASELINE } from "../../src/rumble/baseline";
import { sortItems, validateBaseline } from "../../src/rumble/logic";
import type { RumbleBaseline } from "../../src/rumble/types";

function enabled(): boolean {
  return process.env.RUMBLE_ENGINE_ENABLED !== "false";
}

function failure(reason: string, res: Response): Response {
  return res.status(200).json({ ok: false, reason });
}

export function registerRumbleRoutes(app: Express, baseline: RumbleBaseline = RUMBLE_BASELINE): void {
  const validation = validateBaseline(baseline);

  const guard = (res: Response): Response | null => {
    if (!enabled()) return failure("disabled", res);
    if (!validation.valid) return failure("invalid-baseline", res);
    return null;
  };

  app.get("/api/rumble", (_req: Request, res: Response) => {
    if (guard(res)) return;
    return res.json({
      ok: true,
      version: baseline.version,
      generatedAt: baseline.generatedAt,
      channels: baseline.channels,
      items: sortItems(baseline.items),
    });
  });

  app.get("/api/rumble/baseline", (_req: Request, res: Response) => {
    if (guard(res)) return;
    return res.json({
      ok: true,
      version: baseline.version,
      generatedAt: baseline.generatedAt,
      channels: baseline.channels,
      items: sortItems(baseline.items),
    });
  });

  app.get("/api/rumble/channels", (_req: Request, res: Response) => {
    if (guard(res)) return;
    return res.json({
      ok: true,
      total: baseline.channels.length,
      channels: baseline.channels,
    });
  });

  app.get("/api/rumble/items", (req: Request, res: Response) => {
    if (guard(res)) return;
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : undefined;
    const items = baseline.items.filter((item) => !channelId || item.channelId === channelId);
    return res.json({ ok: true, total: items.length, items: sortItems(items) });
  });
}
