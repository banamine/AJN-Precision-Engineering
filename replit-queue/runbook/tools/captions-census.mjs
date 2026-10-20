#!/usr/bin/env node
// AJN captions eligibility census. READ-ONLY. Node 22, no dependencies.
// Usage:  node tools/captions-census.mjs --out deliver/H_2026-10-18/census FOXNEWSW CNNW MSNOW BBCNEWS ...
//         node tools/captions-census.mjs --selftest
// Per prefix: newest item >= 12 h old (and <= 6 days), its public subtitle file NAMES, then 3 time slices
// (25/50/75 % of runtime). Records numbers only: status, bytes, cue count, first cue start. NEVER writes caption text.
// Politeness: 1 request per 1.8 s, stop on 403/429 (recorded, no retry), body read capped at 256 KiB.
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'AJN-Precision-Engineering/captions-census (read-only; contact owner)';
const GAP_MS = 1800, BODY_CAP = 256 * 1024, MAX_REQUESTS = 80;
const KINDS = [ // order = preference
  { kind: 'align', re: /\.align\.srt$/i, label: 'Broadcast closed captions (aligned)' },
  { kind: 'cc5', re: /\.cc5\.srt$/i, label: 'Broadcast closed captions' },
  { kind: 'asr-srt', re: /\.asr\.srt$/i, label: 'Machine transcript' },
  { kind: 'asr-vtt', re: /\.asr\.vtt$/i, label: 'Machine transcript' },
  { kind: 'vtt', re: /\.vtt$/i, label: 'Captions (WebVTT)' },
];
export function pickKind(names) {
  for (const k of KINDS) { const f = names.find((n) => k.re.test(n)); if (f) return { ...k, file: f }; }
  return null;
}
export function countCues(text) { return (text.match(/-->/g) || []).length; }
export function firstCueStart(text) {
  const m = text.match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->/);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : null;
}
if (process.argv.includes('--selftest')) {
  const assert = (await import('node:assert')).strict;
  assert.equal(pickKind(['x.mp4', 'x.cc5.srt', 'x.align.srt']).kind, 'align');
  assert.equal(pickKind(['x.asr.vtt', 'x.asr.srt']).kind, 'asr-srt');
  assert.equal(pickKind(['x.mp4']), null);
  assert.equal(countCues('1\n00:00:01,000 --> 00:00:03,000\nhi\n\n2\n00:00:04,000 --> 00:00:05,000\nyo'), 2);
  assert.equal(firstCueStart('WEBVTT\n\n00:01.500 --> 00:03.000\nx'), 1.5);
  assert.equal(firstCueStart('1\n00:00:00,850 --> 00:00:02,000\nx'), 0.85);
  console.log('selftest OK'); process.exit(0);
}

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : 'census-out';
const prefixes = args.filter((a, i) => !a.startsWith('--') && i !== oi + 1);
if (!prefixes.length) { console.error('give at least one archive prefix, e.g. FOXNEWSW'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const ledger = join(outDir, 'ledger.ndjson');
let count = 0, last = 0, stopped = null;

async function get(url, { cap = BODY_CAP } = {}) {
  if (stopped) return { status: 0, error: `stopped: ${stopped}` };
  if (count >= MAX_REQUESTS) { stopped = 'request budget'; return { status: 0, error: 'budget' }; }
  const wait = last + GAP_MS - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); count++;
  const u = new URL(url); const t0 = Date.now(); let status = 0, bytes = 0, text = '', error;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    status = res.status;
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer()); bytes = buf.length;
      text = new TextDecoder().decode(buf.subarray(0, cap));
    } else await res.body?.cancel().catch(() => {});
    if (status === 403 || status === 429) stopped = `HTTP ${status}`;
  } catch (e) { error = String(e?.message || e); }
  appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), host: u.host, path: u.pathname, status, ms: Date.now() - t0, bytes, error }) + '\n');
  return { status, text, bytes, error };
}

const now = Date.now(), day = (ms) => new Date(ms).toISOString().slice(0, 10);
const results = [];
for (const prefix of prefixes) {
  const row = { prefix, items: [] };
  const q = `identifier:${prefix}_* AND mediatype:movies AND date:[${day(now - 6 * 864e5)} TO ${day(now - 12 * 36e5)}]`;
  const s = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=date&sort[]=date%20desc&rows=6&page=1&output=json`);
  let docs = []; try { docs = JSON.parse(s.text).response.docs; } catch { /* recorded below */ }
  if (!docs.length) { row.verdict = 'NO_ITEMS'; row.reason = s.error || `search status ${s.status}, 0 docs`; results.push(row); continue; }
  for (const d of docs.slice(0, 2)) {
    const it = { id: d.identifier };
    const m = await get(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, { cap: 4 * 1024 * 1024 });
    let files = []; try { files = JSON.parse(m.text).files || []; } catch { /* keep empty */ }
    const names = files.map((f) => f.name);
    const kind = pickKind(names);
    const mp4 = files.find((f) => /\.mp4$/i.test(f.name) && f.length);
    const runtime = mp4 ? Number(mp4.length) : 0;
    it.runtimeSeconds = runtime || null;
    it.subtitleFiles = files.filter((f) => /\.(srt|vtt)$/i.test(f.name)).map((f) => ({ name: f.name.replace(d.identifier, '<id>'), size: Number(f.size) || null, private: f.private === 'true' || f.private === true }));
    it.kind = kind ? kind.kind : 'none'; it.label = kind ? kind.label : null; it.slices = [];
    if (kind && runtime > 300) {
      for (const frac of [0.25, 0.5, 0.75]) {
        const start = Math.floor(runtime * frac / 60) * 60;
        const r = await get(`https://archive.org/download/${encodeURIComponent(d.identifier)}/${encodeURIComponent(kind.file)}?t=${start}/${start + 60}`);
        it.slices.push({ start, status: r.status, bytes: r.bytes, cues: r.text ? countCues(r.text) : 0, firstCueStart: r.text ? firstCueStart(r.text) : null, error: r.error });
      }
    }
    it.pass = it.slices.filter((x) => x.status === 200 && x.cues > 0).length >= 2;
    row.items.push(it);
  }
  const passes = row.items.filter((i) => i.pass).length;
  row.verdict = passes >= 2 ? 'ELIGIBLE' : passes === 1 ? 'PARTIAL' : 'NOT_ELIGIBLE';
  results.push(row);
}
writeFileSync(join(outDir, 'census.json'), JSON.stringify({ at: new Date().toISOString(), requests: count, stopped, results }, null, 2));
console.log(`requests used: ${count}${stopped ? ` (STOPPED: ${stopped})` : ''}`);
for (const r of results) console.log(`${r.prefix.padEnd(10)} ${r.verdict}  ${r.items?.map((i) => `${i.kind}:${i.slices.map((s) => `${s.status}/${s.cues}`).join(',') || '-'}`).join(' | ') || r.reason}`);
