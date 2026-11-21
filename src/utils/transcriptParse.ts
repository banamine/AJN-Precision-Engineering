/* Podcast transcript parsing (SRT and WebVTT). Pure: no React, no network. Used by the server route (which sends the cues to the
 * browser) and by the tests. Times are on the CLEAN show's clock (the feed transcript has no ads in it).
 * A transcript that cannot be read gives an empty list, never invented text. */

export interface Cue { s: number; e: number; t: string; sp?: string }
export interface ParsedTranscript { cues: Cue[]; hasSpeakers: boolean }

const MAX_CUES = 20000;
const MAX_TEXT = 600;

function stamp(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0').slice(0, 3)) / 1000;
}
const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
/** "Speaker 2: text" -> {sp:"Speaker 2", t:"text"}. Only a short label before the first colon counts. */
function splitSpeaker(line: string): { sp?: string; t: string } {
  const m = /^((?:Speaker|SPEAKER|Host|Guest|Caller)\s*\d{0,2}|[A-Z][A-Za-z.'-]{1,15}(?: [A-Z][A-Za-z.'-]{1,15})?)\s*:\s+(\S[\s\S]*)$/.exec(line);
  return m ? { sp: m[1], t: m[2] } : { t: line };
}

export function parseTranscript(raw: string): ParsedTranscript {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  let hasSpeakers = false;
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TIME.test(l));
    if (at < 0) continue; // WEBVTT header, NOTE blocks, numbers alone
    const m = TIME.exec(lines[at]) as RegExpExecArray;
    const s = stamp(m[1], m[2], m[3], m[4]); const e = stamp(m[5], m[6], m[7], m[8]);
    if (!(e >= s) || !Number.isFinite(s)) continue;
    const body = decode(lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    if (!body) continue;
    const { sp, t } = splitSpeaker(body);
    cues.push({ s: Math.round(s * 1000) / 1000, e: Math.round(e * 1000) / 1000, t: t.slice(0, MAX_TEXT), ...(sp ? { sp } : {}) });
    if (cues.length >= MAX_CUES) break;
  }
  // A name before a colon only counts as a speaker when it repeats ("Speaker 2:" always counts): "Breaking: ..." once is just text.
  const seen = new Map<string, number>();
  for (const c of cues) if (c.sp) seen.set(c.sp, (seen.get(c.sp) ?? 0) + 1);
  for (const c of cues) {
    if (c.sp && !/^(?:Speaker|SPEAKER|Host|Guest|Caller)\b/.test(c.sp) && (seen.get(c.sp) ?? 0) < 3) { c.t = `${c.sp}: ${c.t}`; delete c.sp; }
    if (c.sp) hasSpeakers = true;
  }
  cues.sort((a, b) => a.s - b.s);
  return { cues, hasSpeakers };
}

/** Pick the transcript link out of one feed item: SRT or WebVTT only (the other formats are not read). SRT first. */
export function pickTranscriptLink(itemXml: string): string | undefined {
  const found: Array<{ url: string; rank: number }> = [];
  const re = /<podcast:transcript\b([^>]*?)\/?>/gi;
  for (let m = re.exec(itemXml); m; m = re.exec(itemXml)) {
    const a = m[1];
    const url = /\burl\s*=\s*"([^"]+)"/i.exec(a)?.[1]?.replace(/&amp;/g, '&');
    const type = (/\btype\s*=\s*"([^"]+)"/i.exec(a)?.[1] ?? '').toLowerCase();
    if (!url || !/^https:\/\//i.test(url)) continue;
    if (/srt|subrip/.test(type) || /\.srt(\?|$)/i.test(url)) found.push({ url, rank: 0 });
    else if (/vtt/.test(type) || /\.vtt(\?|$)/i.test(url)) found.push({ url, rank: 1 });
  }
  found.sort((a, b) => a.rank - b.rank);
  return found[0]?.url;
}

/** Pauses in the talk: the quiet gaps between cues, as the time at the middle of each gap. These are what the lock-on compares with real silences. */
export function transcriptPauses(cues: readonly Cue[], minGap = 0.8): number[] {
  const out: number[] = [];
  for (let i = 1; i < cues.length; i++) {
    const gap = cues[i].s - cues[i - 1].e;
    if (gap >= minGap) out.push((cues[i].s + cues[i - 1].e) / 2);
  }
  return out;
}
