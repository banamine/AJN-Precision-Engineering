#!/usr/bin/env node
/* Phase 0 probe (read-only unless --apply): can the browser's audio analyser read each podcast's audio file?
 * For every enabled show in src/data/podcastSources.json it reads the RSS feed, takes the newest enclosure, follows the redirect chain by hand
 * (sending an Origin header like the live app does) and records Access-Control-Allow-Origin at every hop.
 *   direct  : every hop allows CORS                         -> corsVerified:true
 *   resolve : a tracker hop blocks it, the final CDN allows  -> corsVerified:true, meterVia:"resolve" (server walks the chain, CDN played directly)
 *   proxy   : the final file host blocks it                  -> corsVerified:true, meterVia:"proxy"   (bounded slices via /api/podcast/proxy; costs Cloud Run bandwidth)
 *   error   : feed or file did not answer                    -> nothing changes
 * Run from the repo root (needs Node 18+, your own internet):
 *   node tools/probe-podcast-cors.mjs                 all enabled shows not yet verified; writes tools/out/podcast-cors-report.{json,md}
 *   node tools/probe-podcast-cors.mjs --all           also re-check the 21 already flagged
 *   node tools/probe-podcast-cors.mjs --only goodfellows,candace
 *   node tools/probe-podcast-cors.mjs --apply         then edits ONLY the lines of shows without corsVerified (a .bak copy is kept first)
 * Never commits or pushes. Review the report before --apply. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const FILE = 'src/data/podcastSources.json';
const ORIGIN = process.env.PROBE_ORIGIN || 'https://ajn-precision-engineering.ai.studio';
const UA = 'AJN-Precision-Engineering/1.0 (podcast CORS probe)';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (args.find((a) => a.startsWith('--only=')) || (args.includes('--only') ? '--only=' + args[args.indexOf('--only') + 1] : '')).replace('--only=', '').split(',').filter(Boolean);
const timeout = (ms) => AbortSignal.timeout(ms);

const text = readFileSync(FILE, 'utf8');
const sources = JSON.parse(text).sources.filter((s) => s.enabled);
const todo = sources.filter((s) => (only.length ? only.includes(s.id) : flag('--all') || !s.corsVerified));
console.log(`Probing ${todo.length} of ${sources.length} enabled shows from origin ${ORIGIN}\n`);

const allows = (h) => { const v = h.get('access-control-allow-origin'); return v === '*' || v === ORIGIN; };

async function firstEnclosure(feedUrl) {
  const r = await fetch(feedUrl, { headers: { 'user-agent': UA, accept: 'application/rss+xml, text/xml, */*' }, redirect: 'follow', signal: timeout(20000) });
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  const xml = await r.text();
  const m = xml.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i);
  if (!m) throw new Error('no <enclosure> in feed');
  return m[1].replace(/&amp;/g, '&');
}

async function hop(url) {
  const base = { headers: { origin: ORIGIN, 'user-agent': UA, range: 'bytes=0-0' }, redirect: 'manual', signal: timeout(20000) };
  let r = await fetch(url, { ...base, method: 'HEAD' });
  if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(url, { ...base, method: 'GET' });
  try { await r.body?.cancel(); } catch { /* ignore */ }
  return r;
}

async function probe(show) {
  const out = { id: show.id, name: show.name, verdict: 'error', hops: [] };
  try {
    let url = await firstEnclosure(show.feedUrl); out.enclosure = url;
    for (let i = 0; i < 10; i++) {
      const r = await hop(url);
      const loc = r.headers.get('location');
      out.hops.push({ host: new URL(url).host, status: r.status, cors: allows(r.headers), acao: r.headers.get('access-control-allow-origin') || null, acceptRanges: r.headers.get('accept-ranges') || null });
      if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).href; continue; }
      if (r.status >= 400) throw new Error(`file HTTP ${r.status} at ${new URL(url).host}`);
      break;
    }
    const last = out.hops[out.hops.length - 1];
    out.finalHost = last.host;
    out.verdict = out.hops.every((h) => h.cors) ? 'direct' : last.cors ? 'resolve' : 'proxy';
  } catch (e) { out.error = String(e?.message || e); }
  return out;
}

const results = [];
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { for (let s; (s = queue.shift());) { const r = await probe(s); results.push(r); console.log(`${r.verdict.padEnd(8)} ${s.id}${r.error ? '  (' + r.error + ')' : r.finalHost ? '  -> ' + r.finalHost : ''}`); } }));
results.sort((a, b) => a.id.localeCompare(b.id));

mkdirSync('tools/out', { recursive: true });
const date = new Date().toISOString().slice(0, 10);
writeFileSync('tools/out/podcast-cors-report.json', JSON.stringify({ probedAt: new Date().toISOString(), origin: ORIGIN, results }, null, 2));
const count = (v) => results.filter((r) => r.verdict === v).length;
const md = [`# Podcast CORS probe ${date}`, `Origin: ${ORIGIN}. direct ${count('direct')} · resolve ${count('resolve')} · proxy ${count('proxy')} · error ${count('error')}`, '', '| show | verdict | final host | note |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.verdict} | ${r.finalHost || ''} | ${r.error || ''} |`)].join('\n');
writeFileSync('tools/out/podcast-cors-report.md', md + '\n');
console.log(`\ndirect ${count('direct')} · resolve ${count('resolve')} · proxy ${count('proxy')} · error ${count('error')}\nReport: tools/out/podcast-cors-report.md (+ .json)`);

if (flag('--apply')) {
  copyFileSync(FILE, FILE + '.bak');
  const lines = text.split('\n'); let changed = 0;
  for (const r of results) {
    if (r.verdict === 'error') continue;
    const i = lines.findIndex((l) => l.includes(`"id": "${r.id}"`));
    if (i < 0 || lines[i].includes('"corsVerified"')) continue;
    const add = `"enabled": true, "corsVerified": true${r.verdict === 'direct' ? '' : `, "meterVia": "${r.verdict}"`}, "verifiedAt": "${date}"`;
    if (!lines[i].includes('"enabled": true')) continue;
    lines[i] = lines[i].replace('"enabled": true', add); changed++;
  }
  writeFileSync(FILE, lines.join('\n'));
  JSON.parse(readFileSync(FILE, 'utf8')); // throws if the edit broke the JSON
  console.log(`--apply: ${changed} shows updated in ${FILE} (backup ${FILE}.bak). Review with git diff.`);
} else console.log('Dry run: nothing in the app was changed. Add --apply to write the flags.');
