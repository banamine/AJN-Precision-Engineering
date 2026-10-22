import { archiveApiFetch } from './archiveLimiter';
import { parseSrt, type Cue } from './captions/captionCore';
import { filesFromMetadata } from './rush';
import {
  INFOWARS_CHILD_ID, InfowarsServiceError, type InfowarsFile, type InfowarsItemMetadata,
  getInfowarsCandidateSnapshot, getInfowarsItemMetadata,
} from './infowarsRadio';

export const AUDIO_ASR_LABEL = 'Machine transcript (Archive ASR, may contain errors)';
export const AUDIO_ASR_MAX_BYTES = 256 * 1024;
export const AUDIO_ASR_SLICE_SECONDS = 60;

export class AudioAsrError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfter?: string | null) {
    super(message);
    this.name = 'AudioAsrError';
  }
}
export interface AudioAsrPlan {
  identifier: string;
  source: 'asr';
  label: typeof AUDIO_ASR_LABEL;
  file: string;
}
export interface AudioAsrSlice {
  identifier: string;
  source: 'asr';
  label: typeof AUDIO_ASR_LABEL;
  sliceStart: number;
  timeBase: 'relative';
  bytes: number;
  cues: Cue[];
}
export interface AudioAsrDependencies {
  fetchImpl?: typeof fetch;
  getCandidates?: typeof getInfowarsCandidateSnapshot;
  getMetadata?: typeof getInfowarsItemMetadata;
  enabled?: () => boolean;
}

const isTrue = (v: unknown) => v === true || String(v ?? '').toLowerCase() === 'true';
const isPublic = (f: InfowarsFile) => !isTrue(f.private);
const AUDIO = /\.(?:mp3|m4a|aac)$/i;
const ASR = /\.asr\.srt$/i;

function selectedAsrFile(metadata: InfowarsItemMetadata): string | null {
  if (isTrue(metadata.private) || isTrue(metadata.is_dark) || isTrue(metadata.restricted)) return null;
  const publicFiles = metadata.files.filter(isPublic);
  const audio = filesFromMetadata({ files: publicFiles })[0];
  if (!audio || !AUDIO.test(audio.file)) return null;
  const asrFiles = metadata.files.filter((f) => ASR.test(f.name) && isPublic(f)).sort((a, b) => a.name.localeCompare(b.name));
  const exact = asrFiles.find((f) => f.name.toLowerCase() === `${audio.file}.asr.srt`.toLowerCase());
  if (exact) return exact.name;
  if (asrFiles.length === 1) return asrFiles[0].name; // still sourced only from this item's public metadata list
  const prefix = asrFiles.filter((f) => f.name.toLowerCase().startsWith(`${audio.file.toLowerCase()}.asr.srt`));
  return prefix.length === 1 ? prefix[0].name : null;
}

async function readTextBounded(response: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  if (!response.body) return { text: '', bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new AudioAsrError('slice_too_large', 502, `ASR slice exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all).replace(/^\uFEFF/, ''), bytes: size };
}

export function parseAudioAsrTime(value: unknown): number {
  if (typeof value !== 'string') throw new AudioAsrError('invalid_slice', 400, 't must be <start>/60');
  const match = /^(\d+)\/60$/.exec(value);
  if (!match) throw new AudioAsrError('invalid_slice', 400, 't must be <start>/60');
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start > 4 * 3600 || start % 60 !== 0) {
    throw new AudioAsrError('invalid_slice', 400, 'slice start must be a 60-second boundary at or before 4 hours');
  }
  return start;
}

export function createAudioAsrService(dependencies: AudioAsrDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? archiveApiFetch;
  const getCandidates = dependencies.getCandidates ?? getInfowarsCandidateSnapshot;
  const getMetadata = dependencies.getMetadata ?? getInfowarsItemMetadata;
  const enabled = dependencies.enabled ?? (() => typeof process === 'undefined' || process.env.AJN_AUDIO_ASR !== '0');

  async function plan(identifier: string): Promise<AudioAsrPlan> {
    if (!enabled()) throw new AudioAsrError('asr_disabled', 404, 'Machine transcript is disabled');
    if (!INFOWARS_CHILD_ID.test(identifier)) throw new AudioAsrError('invalid_identifier', 400, 'Invalid radio Archive identifier');
    let candidates;
    try { candidates = await getCandidates(); }
    catch (error) {
      const e = error as InfowarsServiceError;
      throw new AudioAsrError('candidate_list_unavailable', 503, e?.message ?? 'Candidate list unavailable');
    }
    if (!candidates.ids.includes(identifier)) throw new AudioAsrError('not_a_candidate', 404, 'Archive item is not in the radio collection');
    let metadata: InfowarsItemMetadata;
    try { metadata = await getMetadata(identifier); }
    catch (error) {
      const e = error as InfowarsServiceError;
      const status = e?.status === 429 ? 429 : e?.status === 403 ? 502 : 503;
      throw new AudioAsrError('metadata_upstream', status, e?.message ?? 'Archive metadata unavailable', (error as any)?.retryAfter);
    }
    if (isTrue(metadata.private) || isTrue(metadata.is_dark) || isTrue(metadata.restricted)) {
      throw new AudioAsrError('transcript_unavailable', 404, 'No public machine transcript listed for this item');
    }
    const file = selectedAsrFile(metadata);
    if (!file) throw new AudioAsrError('transcript_unavailable', 404, 'No public machine transcript listed for this item');
    return { identifier, source: 'asr', label: AUDIO_ASR_LABEL, file };
  }

  async function slice(identifier: string, time: unknown): Promise<AudioAsrSlice> {
    const sliceStart = parseAudioAsrTime(time);
    const selected = await plan(identifier);
    const path = selected.file.split('/').map(encodeURIComponent).join('/');
    const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${path}?t=${sliceStart}/${sliceStart + AUDIO_ASR_SLICE_SECONDS}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (audio ASR slice)' },
      });
    } catch (error) {
      throw new AudioAsrError('slice_upstream', 503, `Archive ASR slice request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const status = response.status === 429 ? 429 : response.status === 403 ? 502 : response.status >= 500 ? 503 : 404;
      await response.body?.cancel().catch(() => {});
      throw new AudioAsrError('slice_upstream', status, `Archive ASR slice HTTP ${response.status}${retryAfter ? ' with Retry-After' : ''}`, retryAfter);
    }
    const { text, bytes } = await readTextBounded(response, AUDIO_ASR_MAX_BYTES);
    const raw = parseSrt(text);
    // Archive's ?t=S/E slice timestamps are relative; convert to the parent's
    // absolute program time exactly once. Transcript text never enters a cache or log.
    const cues = raw.map((cue) => ({ start: cue.start + sliceStart, end: cue.end + sliceStart, text: cue.text }));
    return { identifier, source: 'asr', label: AUDIO_ASR_LABEL, sliceStart, timeBase: 'relative', bytes, cues };
  }
  return { plan, slice };
}

export type AudioAsrService = ReturnType<typeof createAudioAsrService>;
export const audioAsrService = createAudioAsrService();
