#!/usr/bin/env node
// Offline loudness batch: measure -> (constant gain | two-pass linear loudnorm) -> re-measure -> log. Originals are never modified.
// Usage: node tools/loudness/normalize-batch.mjs --in <folder> --out <folder> [--lufs -16] [--tp -1.5] [--lra 11] [--tolerance 0.5] [--max-gain 12] [--force] [--dry-run]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname, sep } from 'node:path';
import { DEFAULTS, parseLoudnormJson, planFor, evaluate, outliers, round2, CSV_COLUMNS, csvCell } from './lib.mjs';

const EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const opt = { ...DEFAULTS, lufs: Number(val('lufs', DEFAULTS.lufs)), tp: Number(val('tp', DEFAULTS.tp)), lra: Number(val('lra', DEFAULTS.lra)), tolerance: Number(val('tolerance', DEFAULTS.tolerance)), maxGain: Number(val('max-gain', DEFAULTS.maxGain)) };
const inDir = val('in'); const outDir = val('out');
if (!inDir || !outDir) { console.error('Need --in <folder> and --out <folder>'); process.exit(2); }
const IN = resolve(inDir), OUT = resolve(outDir);
if (IN === OUT || OUT.startsWith(IN + sep)) { console.error('--out must be a different folder, not inside --in (originals must stay untouched).'); process.exit(2); }

function run(cmd, args) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { windowsHide: true }); let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => res({ code: -1, out, err: String(e) })); p.on('close', (code) => res({ code, out, err }));
  });
}
const sha256 = (f) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
function walk(d) { return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : EXT.has(extname(e.name).toLowerCase()) ? [join(d, e.name)] : [])); }

const measureArgs = (f) => ['-hide_banner', '-nostats', '-i', f, '-map', '0:a:0', '-af', `loudnorm=I=${opt.lufs}:TP=${opt.tp}:LRA=${opt.lra}:print_format=json`, '-f', 'null', '-'];
const measure = async (f) => { const r = await run('ffmpeg', measureArgs(f)); return r.code === 0 ? parseLoudnormJson(r.err) : null; };
async function probe(f) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,bit_rate,channels', '-of', 'json', f]);
  try { return JSON.parse(r.out).streams[0]; } catch { return null; }
}
const ENC = { mp3: 'libmp3lame', aac: 'aac', flac: 'flac', vorbis: 'libvorbis', opus: 'libopus' };
function encoderArgs(p) {
  const codec = p?.codec_name ?? 'mp3'; const a = [];
  a.push('-c:a', codec.startsWith('pcm_') ? codec : ENC[codec] ?? 'libmp3lame');
  if (!codec.startsWith('pcm_') && codec !== 'flac') a.push('-b:a', String(Number(p?.bit_rate) > 0 ? p.bit_rate : 192000));
  if (p?.sample_rate) a.push('-ar', String(p.sample_rate)); // loudnorm can emit 192 kHz; pin the original rate
  return a;
}

const ver = (await run('ffmpeg', ['-version'])).out.split('\n')[0] || '';
if (!ver) { console.error('ffmpeg not found on PATH. Windows: winget install Gyan.FFmpeg  (free), then open a NEW PowerShell window.'); process.exit(2); }
const settingsHash = createHash('sha256').update(JSON.stringify({ lufs: opt.lufs, tp: opt.tp, lra: opt.lra, tol: opt.tolerance, mg: opt.maxGain, ver })).digest('hex').slice(0, 16);
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'normalize-log.jsonl');
const prior = new Map();
if (existsSync(LOG)) for (const l of readFileSync(LOG, 'utf8').split('\n')) { try { const r = JSON.parse(l); prior.set(r.file, r); } catch { /* skip bad line */ } }

const files = walk(IN).sort(); const records = []; const measured = [];
console.log(`${files.length} file(s). Target ${opt.lufs} LUFS / ${opt.tp} dBTP. ${ver}`);
for (const f of files) {
  const rel = relative(IN, f).split(sep).join('/'); const outFile = join(OUT, rel);
  const rec = { file: rel, status: 'fail', method: null, gain_db: null, in_lufs: null, in_tp: null, in_lra: null, out_lufs: null, out_tp: null, out_lra: null, flags: [], reasons: [], sha256_original: null, ffmpeg: ver, settings: settingsHash, target_lufs: opt.lufs, target_tp: opt.tp, time: new Date().toISOString() };
  try {
    rec.sha256_original = await sha256(f);
    const pr = prior.get(rel);
    if (!flag('force') && pr && pr.status === 'pass' && pr.sha256_original === rec.sha256_original && pr.settings === settingsHash && existsSync(outFile)) {
      console.log(`skip (unchanged) ${rel}`); measured.push({ key: rel, i: pr.in_lufs }); continue;
    }
    const m = await measure(f);
    if (m) { rec.in_lufs = m.i; rec.in_tp = m.tp; rec.in_lra = m.lra; if (m.lra !== null && m.lra > opt.lraReview) rec.flags.push(`LRA ${m.lra} > ${opt.lraReview}: loudness alone will not even out quiet/loud sections`); }
    measured.push({ key: rel, i: m?.i ?? null });
    const plan = planFor(m, opt); rec.method = plan.method ?? null; rec.gain_db = plan.gain ?? null;
    if (plan.action === 'review') { rec.status = 'review'; rec.reasons.push(plan.reason); }
    else if (plan.action === 'copy-ok') { rec.status = 'pass'; rec.reasons.push(plan.reason); rec.method = 'none (not re-encoded, not copied)'; }
    else if (flag('dry-run')) { rec.status = 'dry-run'; }
    else {
      mkdirSync(dirname(outFile), { recursive: true });
      const p = await probe(f);
      let method = plan.method, gain = plan.gain, iTarget = opt.lufs, ev = null, o = null, failed = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const filter = method === 'constant-gain'
          ? `volume=${gain}dB`
          : `loudnorm=I=${iTarget}:TP=${opt.tp}:LRA=${opt.lra}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=json`;
        const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', f, '-map', '0:a:0', '-map_metadata', '0', '-af', filter, ...encoderArgs(p), outFile]);
        if (r.code !== 0) { rec.reasons.push('ffmpeg failed: ' + r.err.split('\n').slice(-3).join(' ').trim()); failed = true; break; }
        if (method !== 'constant-gain' && parseLoudnormJson(r.err)?.type === 'dynamic') rec.flags.push('loudnorm fell back to dynamic mode (more processing than a linear gain)');
        o = await measure(outFile); ev = evaluate(o, opt);
        if (ev.ok) break;
        // Lossy re-encoding can shift loudness a little. Correct ONCE, re-encoding from the ORIGINAL (no generation loss), only if the peak still fits.
        if (attempt === 1 && method === 'constant-gain' && o && o.i !== null && Math.abs(o.i - opt.lufs) <= 2) {
          const g2 = round2(gain + (opt.lufs - o.i));
          if (m.tp + g2 <= opt.tp && Math.abs(g2) <= opt.maxGain) { rec.flags.push(`re-encode shifted loudness to ${o.i} LUFS; gain corrected ${gain} -> ${g2} dB`); gain = g2; continue; }
        }
        if (attempt === 1 && method !== 'constant-gain' && o && o.i !== null && Math.abs(o.i - opt.lufs) <= 2) { // same one-shot correction for the linear path: aim the filter's target at the shift
          iTarget = round2(opt.lufs + (opt.lufs - o.i)); rec.flags.push(`re-encode shifted loudness to ${o.i} LUFS; loudnorm target adjusted to ${iTarget}`); continue;
        }
        break;
      }
      rec.method = method; rec.gain_db = gain ?? null;
      if (!failed) {
        if (o) { rec.out_lufs = o.i; rec.out_tp = o.tp; rec.out_lra = o.lra; }
        if (ev?.ok) rec.status = rec.flags.some((x) => x.startsWith('loudnorm fell back')) ? 'review' : 'pass';
        else { // measured but off target (usually: reaching the target would need peak limiting) -> a human decides; no output is left behind
          rec.status = o && o.i !== null ? 'review' : 'fail';
          rec.reasons.push(...(ev?.reasons ?? ['not validated']), ...(rec.status === 'review' ? ['not corrected automatically: would need limiting (peak headroom) or is outside tolerance'] : []));
          try { unlinkSync(outFile); } catch { /* ignore */ }
        }
      }
    }
  } catch (e) { rec.reasons.push(String(e?.message ?? e)); }
  console.log(`${rec.status.padEnd(7)} ${rel}  in ${rec.in_lufs ?? '?'} LUFS -> out ${rec.out_lufs ?? '-'}  ${rec.method ?? ''} ${rec.reasons.join('; ')}`);
  appendFileSync(LOG, JSON.stringify(rec) + '\n'); records.push(rec);
}
const odd = outliers(measured);
for (const r of records) if (odd.has(r.file)) { r.flags.push('outlier: input loudness far from the rest of the batch'); appendFileSync(LOG, JSON.stringify({ ...r, note: 'flag added after batch' }) + '\n'); }
// CSV = latest record per file
const latest = new Map(); for (const l of readFileSync(LOG, 'utf8').split('\n')) { try { const r = JSON.parse(l); latest.set(r.file, r); } catch { /* skip */ } }
writeFileSync(join(OUT, 'normalize-log.csv'), [CSV_COLUMNS.join(','), ...[...latest.values()].map((r) => CSV_COLUMNS.map((c) => csvCell(Array.isArray(r[c]) ? r[c].join(' | ') : c === 'sha256_original' ? r.sha256_original : r[c])).join(','))].join('\n') + '\n');
const count = (s) => records.filter((r) => r.status === s).length;
console.log(`\nDone. pass ${count('pass')} | review ${count('review')} | fail ${count('fail')} | dry-run ${count('dry-run')}. Log: ${join(OUT, 'normalize-log.csv')}`);
process.exit(count('fail') ? 1 : 0);
