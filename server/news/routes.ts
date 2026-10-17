import type { Express, Request, Response } from "express";
import { resolveNewsLink } from "./resolve";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { start: number; count: number }>();

function limited(ip: string, now = Date.now()): boolean {
  const entry = hits.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

/** GET /api/news/resolve?url=<video page url | embed url | embed id>  ->  {ok:true,media} | {ok:false,reason}. Always HTTP 200. */
export function registerNewsRoutes(app: Express): void {
  app.get("/api/news/resolve", async (req: Request, res: Response) => {
    if (process.env.RUMBLE_ENGINE_ENABLED === "false") {
      return res.status(200).json({ ok: false, reason: "disabled" });
    }
    const raw = req.query.url;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 600) {
      return res.status(200).json({ ok: false, reason: "invalid-input" });
    }
    if (limited(req.ip ?? "unknown")) {
      return res.status(200).json({ ok: false, reason: "rate-limited" });
    }
    return res.status(200).json(await resolveNewsLink(raw));
  });
}
