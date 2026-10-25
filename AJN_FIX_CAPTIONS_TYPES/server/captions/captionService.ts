// Server side of the TV News caption feature. Every upstream URL is built here from validated parts:
// the browser never supplies a URL. Caption TEXT is never stored, cached or logged by the server.
import { validateArchiveRedirect } from '../archiveFetch';
import {
  type Cue, type CaptionKind, type CaptionSuffix, KIND_LABEL, MAX_SLICE_BODY_BYTES, captionSliceUrl, isCaptionSuffix,
  isTvNewsId, kindOfSuffix, networkOfId, parseSrt, pickCaptionFile, retryAfterSeconds, toProgramTime, validSliceStart,
} from './captionCore';

export const UPSTREAM_MIN_GAP_MS = 1800;   // spacing between caption/metadata request STARTS, process wide
export const UPSTREAM_TIMEOUT_MS = 10_000;
export const DEFAULT_COOLDOWN_S = 30;
export const PLAN_TTL_MS = 10 * 60 * 1000;  // file NAMES only
export const PLAN_MAX_ENTRIES = 300;
const METADATA_MAX_BYTES = 1024 * 1024;
const USER_AGENT = 'AJN-Precision-Engineering-Captions/1.0 (+https://ajn-precision-engineering.ai.studio; contact: owner)';

export type CaptionPlan =
  | { id: string; source: 'none' }
  | { id: string; source: CaptionSuffix; kind: CaptionKind; file: string; label: string };

export interface ServiceFail { ok: false; status: number; error: string; retryAfter?: number }
export interface ServiceOk<T> { ok: true; value: T }
export type ServiceResult<T> = ServiceOk<T> | ServiceFail;
interface IdOk { ok: true; id: string }

export interface SliceValue { id: string; source: CaptionSuffix; kind: CaptionKind; sliceStart: number; empty: boolean; timeBase: 'relative' | 'absolute'; cues: Cue[] }

export interface CaptionServiceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  allowedNetworks: ReadonlySet<string>;
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export function createCaptionService(deps: CaptionServiceDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stats = { upstreamRequests: 0, cooldownRejects: 0 };

  let cooldownUntil = 0;
  let lastStart = 0;
  let chain: Promise<void> = Promise.resolve();

  /** Serialise upstream starts at >= UPSTREAM_MIN_GAP_MS apart. */
  function gate(): Promise<void> {
    const mine = chain.then(async () => {
      const wait = Math.max(0, lastStart + UPSTREAM_MIN_GAP_MS - now());
      if (wait > 0) await sleep(wait);
      lastStart = now();
    });
    chain = mine.catch(() => undefined);
    return mine;
  }

  function cooling(): number { return Math.max(0, Math.ceil((cooldownUntil - now()) / 1000)); }

  /** One upstream GET with timeout, client-abort, and manual redirects restricted to archive hosts. */
  async function upstreamGet(url: string, clientSignal: AbortSignal | undefined, accept: string): Promise<Response> {
    await gate();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    const onAbort = () => ac.abort();
    clientSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      let target = url;
      for (let hop = 0; hop < 3; hop += 1) {
        validateArchiveRedirect(new URL(target));
        stats.upstreamRequests += 1;
        const res = await fetchImpl(target, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': USER_AGENT, Accept: accept } });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return res;
          target = new URL(loc, target).toString();
          continue;
        }
        return res;
      }
      throw new Error('too many redirects');
    } finally {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onAbort);
    }
  }

  function failure(res: Response): { ok: false; status: number; error: string; retryAfter?: number } {
    if (res.status === 429) {
      const retryAfter = retryAfterSeconds(res.headers.get('retry-after'), now(), DEFAULT_COOLDOWN_S);
      cooldownUntil = Math.max(cooldownUntil, now() + retryAfter * 1000);
      return { ok: false, status: 429, error: 'archive_rate_limited', retryAfter };
    }
    if (res.status === 403) return { ok: false, status: 403, error: 'caption_forbidden' };
    if (res.status === 404) return { ok: false, status: 404, error: 'caption_file_not_found' };
    return { ok: false, status: 502, error: 'archive_upstream_error' };
  }

  // ---- plan: which caption file does this program have? (file NAMES only are cached) ----
  const planCache = new Map<string, { expires: number; plan: CaptionPlan }>();
  const planInflight = new Map<string, Promise<ServiceResult<CaptionPlan>>>();

  function checkId(id: unknown): IdOk | ServiceFail {
    if (!isTvNewsId(id)) return { ok: false, status: 400, error: 'bad_identifier' };
    if (!deps.allowedNetworks.has(networkOfId(id))) return { ok: false, status: 400, error: 'network_not_supported' };
    return { ok: true, id };
  }

  async function plan(idIn: unknown, signal?: AbortSignal): Promise<ServiceResult<CaptionPlan>> {
    const v = checkId(idIn);
    if (!v.ok) return v as ServiceFail;
    const id = (v as IdOk).id;
    const hit = planCache.get(id);
    if (hit && hit.expires > now()) return { ok: true, value: hit.plan };
    const cool = cooling();
    if (cool > 0) { stats.cooldownRejects += 1; return { ok: false, status: 429, error: 'archive_rate_limited', retryAfter: cool }; }
    const pending = planInflight.get(id);
    if (pending) return pending;
    const run = (async (): Promise<ServiceResult<CaptionPlan>> => {
      try {
        const res = await upstreamGet(`https://archive.org/metadata/${encodeURIComponent(id)}`, signal, 'application/json');
        if (res.status !== 200) return failure(res);
        const text = await readCapped(res, METADATA_MAX_BYTES);
        if (text === null) return { ok: false, status: 502, error: 'metadata_too_large' };
        let body: { files?: Array<{ name?: string }> } | null = null;
        try { body = JSON.parse(text); } catch { return { ok: false, status: 502, error: 'metadata_unreadable' }; }
        if (!body || !Array.isArray(body.files)) return { ok: false, status: 502, error: 'metadata_unreadable' };
        const pick = pickCaptionFile(id, body.files);
        const value: CaptionPlan = pick ? { id, source: pick.suffix, kind: pick.kind, file: pick.file, label: KIND_LABEL[pick.kind] } : { id, source: 'none' };
        if (planCache.size >= PLAN_MAX_ENTRIES) planCache.delete(planCache.keys().next().value as string);
        planCache.set(id, { expires: now() + PLAN_TTL_MS, plan: value });
        return { ok: true, value };
      } catch (e) {
        if (signal?.aborted) return { ok: false, status: 499, error: 'client_closed' };
        return { ok: false, status: 502, error: 'archive_unreachable' };
      } finally { planInflight.delete(id); }
    })();
    planInflight.set(id, run);
    return run;
  }

  // ---- slice: one 60 s window of one caption file ----
  async function slice(idIn: unknown, srcIn: unknown, startIn: unknown, signal?: AbortSignal): Promise<ServiceResult<SliceValue>> {
    const v = checkId(idIn);
    if (!v.ok) return v as ServiceFail;
    if (!isCaptionSuffix(srcIn)) return { ok: false, status: 400, error: 'bad_source' };
    if (!validSliceStart(startIn)) return { ok: false, status: 400, error: 'bad_slice_start' };
    const id = v.id; const suffix = srcIn; const sliceStart = startIn;
    const cool = cooling();
    if (cool > 0) { stats.cooldownRejects += 1; return { ok: false, status: 429, error: 'archive_rate_limited', retryAfter: cool }; }
    try {
      const res = await upstreamGet(captionSliceUrl(id, suffix, sliceStart), signal, 'text/plain');
      if (res.status !== 200) return failure(res);
      const text = await readCapped(res, MAX_SLICE_BODY_BYTES);
      if (text === null) return { ok: false, status: 502, error: 'slice_too_large' };
      const kind = kindOfSuffix(suffix);
      const { cues, timeBase } = toProgramTime(parseSrt(text), sliceStart);
      return { ok: true, value: { id, source: suffix, kind, sliceStart, empty: cues.length === 0, timeBase, cues } };
    } catch {
      if (signal?.aborted) return { ok: false, status: 499, error: 'client_closed' };
      return { ok: false, status: 502, error: 'archive_unreachable' };
    }
  }

  return { plan, slice, stats, cooldownSeconds: cooling, _planCacheSize: () => planCache.size };
}

export type CaptionService = ReturnType<typeof createCaptionService>;
