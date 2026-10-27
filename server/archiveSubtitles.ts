/**
 * English subtitles for Archive videos: finds an English .srt in the item, converts it to WebVTT
 * (the only format a browser <track> accepts) and serves it same-origin at /api/archive/subtitles?id=<identifier>.
 * English only: a .srt is used only when its file name says English (English / eng / en). Nothing is guessed.
 */
import type { Express, Request, Response } from 'express';
import { archiveApiFetch } from './archiveLimiter';

export const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const MISS_TTL_MS = 60 * 60_000;
const MAX_CACHE = 200;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface ArchiveFileEntry { name: string; size?: string | number; format?: string }

/** File name says English: "English", "[English]", ".eng.", ".en." or "_en." etc. */
export function isEnglishSubtitleName(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  return /english/i.test(base) || /(^|[\s._\-[(])(eng|en)([\s._\-\])]|$)/i.test(base.replace(/\.srt$/i, '') + '.');
}

/** Pick the English .srt for an item; prefer one whose name matches the video's base name. */
export function pickEnglishSrt(files: ArchiveFileEntry[], videoName?: string): string | null {
  const stem = (videoName ?? '').split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
  const candidates = files
    .filter((f) => typeof f.name === 'string' && /\.srt$/i.test(f.name) && isEnglishSubtitleName(f.name))
    .filter((f) => !(Number(f.size) > SUBTITLE_MAX_BYTES));
  if (!candidates.length) return null;
  const matched = stem ? candidates.find((f) => f.name.toLowerCase().includes(stem)) : undefined;
  return (matched ?? candidates[0]).name;
}

/** SubRip → WebVTT: header, "," → "." in timestamps, CRLF/BOM normalised, cue numbers dropped. */
export function srtToVtt(srt: string): string {
  const text = srt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length && /^\d+$/.test(lines[0].trim())) lines.shift();
    if (!lines.length) continue;
    const m = /^(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})(.*)$/.exec(lines[0].trim());
    if (!m) continue;
    const pad = (t: string) => (t.length === 7 ? `0${t}` : t);
    const ms = (v: string) => v.padEnd(3, '0');
    const body = lines.slice(1).join('\n').replace(/-->/g, '→').trim();
    if (!body) continue;
    out.push(`${pad(m[1])}.${ms(m[2])} --> ${pad(m[3])}.${ms(m[4])}\n${body}`);
  }
  return `WEBVTT\n\n${out.join('\n\n')}\n`;
}

type Entry = { vtt: string | null; file: string | null; expires: number };
const cache = new Map<string, Entry>();
function remember(key: string, e: Entry) {
  cache.delete(key);
  cache.set(key, e);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

async function readCapped(res: globalThis.Response, cap: number): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > cap) throw new Error('subtitle file too large');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) throw new Error('subtitle file too large');
  return new TextDecoder('utf-8').decode(buf);
}

export async function loadEnglishSubtitles(
  id: string,
  videoName: string | undefined,
  fetchImpl: typeof fetch = archiveApiFetch,
  now = Date.now(),
): Promise<Entry> {
  const key = `${id}|${videoName ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit;
  const meta = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'AJN-Precision-Engineering/Subtitles' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!meta.ok) throw Object.assign(new Error(`metadata HTTP ${meta.status}`), { upstreamStatus: meta.status });
  const body = (await meta.json()) as { files?: ArchiveFileEntry[]; is_dark?: boolean };
  const file = body.is_dark ? null : pickEnglishSrt(Array.isArray(body.files) ? body.files : [], videoName);
  if (!file) {
    const miss: Entry = { vtt: null, file: null, expires: now + MISS_TTL_MS };
    remember(key, miss);
    return miss;
  }
  const url = `https://archive.org/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'AJN-Precision-Engineering/Subtitles' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw Object.assign(new Error(`subtitle HTTP ${res.status}`), { upstreamStatus: res.status });
  const vtt = srtToVtt(await readCapped(res, SUBTITLE_MAX_BYTES));
  const entry: Entry = { vtt, file, expires: now + CACHE_TTL_MS };
  remember(key, entry);
  return entry;
}

export function registerArchiveSubtitleRoutes(app: Express, fetchImpl?: typeof fetch): void {
  app.get('/api/archive/subtitles', async (req: Request, res: Response) => {
    const id = String(req.query.id ?? '');
    const video = typeof req.query.video === 'string' ? req.query.video.slice(0, 300) : undefined;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid_identifier' });
    try {
      const entry = await loadEnglishSubtitles(id, video, fetchImpl);
      if (!entry.vtt) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(404).json({ error: 'no_english_subtitles' });
      }
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=21600');
      res.setHeader('X-AJN-Subtitle-File', encodeURIComponent(entry.file ?? ''));
      return res.status(200).send(entry.vtt);
    } catch (e) {
      const err = e as { message?: string; upstreamStatus?: number };
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'subtitles_unavailable', reason: err.message ?? 'error', upstreamStatus: err.upstreamStatus ?? 0 });
    }
  });
}
