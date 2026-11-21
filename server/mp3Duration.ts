/**
 * MP3 duration from the first bytes of a file (no full download).
 * parseMp3Duration() is pure; probeMp3Duration() fetches a bounded Range slice through safeFetch (SSRF-checked, redirects checked per hop).
 * Returns null whenever the duration cannot be established: callers must then treat the episode as duration-unknown, never guess.
 */
import { anyPublicHost, safeFetch } from './safeFetch';

export const PROBE_BYTES = 256 * 1024;
const BITRATES: Record<string, number[]> = {
  // [version][layer] tables, kbps; index 0 and 15 are invalid
  'V1L3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  'V1L2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  'V1L1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  'V2L3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  'V2L2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  'V2L1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface Mp3Info { seconds: number; method: 'xing' | 'vbri' | 'cbr-estimate' }

function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + ((b[5] & 0x10) ? 10 : 0);
}

/** @param head first bytes of the file; @param totalBytes full length (Content-Range total) for the CBR estimate. */
export function parseMp3Duration(head: Uint8Array, totalBytes?: number): Mp3Info | null {
  const start = id3Size(head);
  for (let i = start; i + 4 < head.length && i < start + 8192; i++) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (head[i + 1] >> 3) & 3, layerBits = (head[i + 1] >> 1) & 3;
    const brIdx = (head[i + 2] >> 4) & 15, rateIdx = (head[i + 2] >> 2) & 3, mono = ((head[i + 3] >> 6) & 3) === 3;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || rateIdx === 3) continue;
    const v1 = verBits === 3, layer = 4 - layerBits;
    const kbps = BITRATES[`${v1 ? 'V1' : 'V2'}L${layer}`][brIdx];
    const rate = RATES[verBits][rateIdx];
    const samples = layer === 1 ? 384 : layer === 2 ? 1152 : (v1 ? 1152 : 576);
    const frameBytes = layer === 1 ? (Math.floor(12 * kbps * 1000 / rate) * 4) : Math.floor((samples / 8) * kbps * 1000 / rate);
    // Xing/Info sits after the 32-byte side info (36 for V1 stereo etc.); VBRI at a fixed 32 after the header.
    const side = v1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + side;
    const tag = String.fromCharCode(...head.subarray(x, x + 4));
    if (tag === 'Xing' || tag === 'Info') {
      const flags = head[x + 7];
      if (flags & 1) {
        const frames = ((head[x + 8] << 24) | (head[x + 9] << 16) | (head[x + 10] << 8) | head[x + 11]) >>> 0;
        if (frames > 0) return { seconds: Math.round(frames * samples / rate), method: 'xing' };
      }
    }
    const v = i + 4 + 32;
    if (String.fromCharCode(...head.subarray(v, v + 4)) === 'VBRI') {
      const frames = ((head[v + 14] << 24) | (head[v + 15] << 16) | (head[v + 16] << 8) | head[v + 17]) >>> 0;
      if (frames > 0) return { seconds: Math.round(frames * samples / rate), method: 'vbri' };
    }
    // No VBR header: assume constant bitrate over the audio bytes. Only trustworthy with a known total size.
    if (!totalBytes || totalBytes <= i || frameBytes <= 0) return null;
    return { seconds: Math.round(((totalBytes - i) * 8) / (kbps * 1000)), method: 'cbr-estimate' };
  }
  return null;
}

const cache = new Map<string, number | null>();
export function clearProbeCacheForTests() { cache.clear(); }

/** Bounded range probe. Cached per key (episode guid). Returns seconds or null; never throws. */
export async function probeMp3Duration(key: string, url: string, fetchImpl?: typeof fetch): Promise<number | null> {
  if (cache.has(key)) return cache.get(key)!;
  let out: number | null = null;
  try {
    const { res } = await safeFetch(url, { allow: anyPublicHost, timeoutMs: 15_000, fetchImpl, maxRedirects: 9,
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}`, 'User-Agent': 'AJN-Precision-Engineering/1.0 (duration probe)' } });
    if (res.ok && res.body) {
      const chunks: Uint8Array[] = []; let got = 0; const reader = res.body.getReader();
      while (got < PROBE_BYTES) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); got += value.length; }
      await reader.cancel().catch(() => {});
      const head = new Uint8Array(Math.min(got, PROBE_BYTES)); let o = 0;
      for (const c of chunks) { const take = c.subarray(0, head.length - o); head.set(take, o); o += take.length; if (o >= head.length) break; }
      const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
      const total = cr ? Number(cr[1]) : (res.status === 200 ? Number(res.headers.get('content-length')) || undefined : undefined);
      const info = parseMp3Duration(head, total);
      out = info && info.seconds > 0 ? info.seconds : null;
    } else await res.body?.cancel().catch(() => {});
  } catch { out = null; }
  cache.set(key, out);
  return out;
}
