import type { Express, Request, Response } from "express";
import { RUMBLE_BASELINE } from "../../src/rumble/baseline";
import { sortItems, validateBaseline } from "../../src/rumble/logic";

const validation = validateBaseline(RUMBLE_BASELINE);

export function registerRumbleRoutes(app: Express): void {
  app.get("/api/rumble", (_req: Request, res: Response) => {
    if (!validation.valid) {
      return res.status(503).json({ error: "Rumble baseline unavailable", errors: validation.errors });
    }

    return res.json({
      version: RUMBLE_BASELINE.version,
      generatedAt: RUMBLE_BASELINE.generatedAt,
      channels: RUMBLE_BASELINE.channels,
      items: sortItems(RUMBLE_BASELINE.items),
    });
  });

  app.get("/api/rumble/channels", (_req: Request, res: Response) => {
    return res.json({
      total: RUMBLE_BASELINE.channels.length,
      channels: RUMBLE_BASELINE.channels,
    });
  });

  app.get("/api/rumble/items", (req: Request, res: Response) => {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : undefined;
    const items = RUMBLE_BASELINE.items.filter((item) => !channelId || item.channelId === channelId);
    return res.json({ total: items.length, items: sortItems(items) });
  });
}
