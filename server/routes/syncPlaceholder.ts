// PLACEHOLDER cloud-sync endpoint for the "recently played" list.
// It validates and counts what the client sends and says so plainly: NOTHING IS STORED. When a real store exists
// (e.g. Directus), replace the body of the handler; the request/response shape below is the contract.
import type { Express, Request, Response } from "express";

export const SYNC_PATH = "/api/sync/recently-played";
export const MAX_SYNC_ITEMS = 50;
const MAX_FIELD = 2048;

export interface SyncItem { id: string; title: string; src: string; mediaType?: string; progressSeconds: number; updatedAt: number }

/** Returns the clean items, or a human-readable reason the body is not acceptable. */
export function validateSyncBody(body: unknown): { ok: true; items: SyncItem[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (b.version !== 1) return { ok: false, error: "Unsupported version (expected 1)." };
  if (!Array.isArray(b.items)) return { ok: false, error: "items must be an array." };
  if (b.items.length > MAX_SYNC_ITEMS) return { ok: false, error: `At most ${MAX_SYNC_ITEMS} items per sync.` };
  const items: SyncItem[] = [];
  for (const [i, raw] of b.items.entries()) {
    const it = raw as Record<string, unknown>;
    const str = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD;
    if (!it || typeof it !== "object" || !str(it.id) || !str(it.title) || !str(it.src)) return { ok: false, error: `Item ${i + 1} needs id, title and src (text, up to ${MAX_FIELD} characters).` };
    const progress = Number(it.progressSeconds), updated = Number(it.updatedAt);
    if (!Number.isFinite(progress) || progress < 0 || !Number.isFinite(updated)) return { ok: false, error: `Item ${i + 1} has an invalid progressSeconds or updatedAt.` };
    items.push({ id: String(it.id), title: String(it.title), src: String(it.src), mediaType: typeof it.mediaType === "string" ? it.mediaType : undefined, progressSeconds: progress, updatedAt: updated });
  }
  return { ok: true, items };
}

export function registerSyncPlaceholder(app: Express): void {
  app.post(SYNC_PATH, (req: Request, res: Response) => {
    const v = validateSyncBody(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error });
    // 202 Accepted + stored:false — truthful: received and validated, not persisted.
    return res.status(202).json({ placeholder: true, stored: false, received: v.items.length, message: "Placeholder endpoint: items were validated but nothing is stored yet." });
  });
}
