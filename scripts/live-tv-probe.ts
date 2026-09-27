/* Live TV transport probe — run on a normal PC (cloud sandboxes block these CDNs).
 *
 *   npx tsx scripts/live-tv-probe.ts [--count 20] [--recheck] [--out probe-results]
 *
 * For a spread of channels from the configured Live TV lists it records, per
 * channel: the manifest status and redirect chain, the CORS header answered to
 * the app's origin, master -> variant -> first segment, the declared CODECS,
 * and (with --recheck) whether the same URLs still work 15 minutes later.
 *
 * Limits, so the table isn't over-read:
 *  - CORS: a script is not blocked by CORS; we only record the header a browser
 *    would see. Real browser playback is still confirmed in the app.
 *  - Codec: taken from the playlist's CODECS attribute; "unknown" if undeclared.
 *  - Pluto playlists go through our /api/hls/playlist proxy in the app, so their
 *    playlist CORS is not a failure (see "ajnRoute"). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_LIVE_SOURCES, checkLiveUrl } from '../server/sources/liveTv';
import { parseM3uEntries } from '../server/sources/classicM3u';
import { hlsProxyAllowed } from '../server/hlsPlaylistProxy';

const ORIGIN = 'https://ajn-precision-engineering.ai.studio';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const COUNT = Number(arg('--count', '20'));
const RECHECK = process.argv.includes('--recheck');
const OUT = arg('--out', `probe-results-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)!;

type Failure = 'MANIFEST_HTTP_ERROR' | 'REDIRECT_BLOCKED' | 'CORS_MISSING' | 'MANIFEST_INVALID' | 'SEGMENT_HTTP_ERROR' | 'CODEC_UNKNOWN' | 'TOKEN_EXPIRED' | 'TIMEOUT' | 'NETWORK';
interface Hop { url: string; status: number }
interface Result {
  channel: string; provider: string; group: string; url: string; ajnRoute: 'direct' | 'playlist-proxy';
  manifestStatus: number | null; redirects: Hop[]; cors: string | null; manifest: 'master' | 'media' | 'invalid' | null;
  variantStatus: number | null; codecs: string | null; resolution: string | null;
  firstSegment: { url: string; status: number | null; contentType: string | null; cors: string | null } | null;
  ms: number; failure: Failure | null; detail?: string;
  recheck15m?: { manifestStatus: number | null; segmentStatus: number | null; failure: Failure | null };
}

const provider = (u: string) => { const h = new URL(u).hostname; return /pluto|jmp2\.uk/.test(h) ? 'Pluto' : /rakuten/.test(h) ? 'Rakuten' : h.split('.').slice(-2).join('.'); };

async function get(url: string, headers: Record<string, string> = {}): Promise<{ res: Response; chain: Hop[]; finalUrl: string }> {
  const chain: Hop[] = [];
  let cur = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': UA, Origin: ORIGIN, ...headers }, signal: AbortSignal.timeout(10_000) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return { res, chain, finalUrl: cur };
    chain.push({ url: cur, status: res.status });
    await res.body?.cancel().catch(() => {});
    const next = new URL(loc, cur);
    if (next.protocol !== 'https:') throw Object.assign(new Error(`redirect to ${next.protocol}`), { failure: 'REDIRECT_BLOCKED' });
    cur = next.toString();
  }
  throw Object.assign(new Error('too many redirects'), { failure: 'REDIRECT_BLOCKED' });
}
const text = async (r: Response) => (await r.text()).slice(0, 1_000_000);
const firstUri = (pl: string) => pl.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));

async function probe(ch: { name: string; group: string; url: string }): Promise<Result> {
  const t0 = Date.now();
  const r: Result = { channel: ch.name, provider: provider(ch.url), group: ch.group, url: ch.url,
    ajnRoute: hlsProxyAllowed(new URL(ch.url).hostname) ? 'playlist-proxy' : 'direct',
    manifestStatus: null, redirects: [], cors: null, manifest: null, variantStatus: null, codecs: null, resolution: null, firstSegment: null, ms: 0, failure: null };
  try {
    const m = await get(ch.url);
    r.manifestStatus = m.res.status; r.redirects = m.chain; r.cors = m.res.headers.get('access-control-allow-origin');
    if (!m.res.ok) { r.failure = 'MANIFEST_HTTP_ERROR'; /* 401/403 = token, geo-block or bot filter; see manifestStatus */ await m.res.body?.cancel().catch(() => {}); return r; }
    const body = await text(m.res);
    if (!body.startsWith('#EXTM3U')) { r.manifest = 'invalid'; r.failure = 'MANIFEST_INVALID'; return r; }
    let media = body, mediaUrl = m.finalUrl;
    if (body.includes('#EXT-X-STREAM-INF')) {
      r.manifest = 'master';
      const lines = body.split(/\r?\n/);
      const i = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
      r.codecs = /CODECS="([^"]+)"/.exec(lines[i])?.[1] ?? null;
      r.resolution = /RESOLUTION=(\d+x\d+)/.exec(lines[i])?.[1] ?? null;
      const v = lines.slice(i + 1).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (!v) { r.failure = 'MANIFEST_INVALID'; return r; }
      mediaUrl = new URL(v, m.finalUrl).toString();
      const vr = await get(mediaUrl);
      r.variantStatus = vr.res.status;
      if (!vr.res.ok) { r.failure = 'MANIFEST_HTTP_ERROR'; await vr.res.body?.cancel().catch(() => {}); return r; }
      media = await text(vr.res); mediaUrl = vr.finalUrl;
    } else r.manifest = 'media';
    const seg = firstUri(media);
    if (!seg) { r.failure = 'MANIFEST_INVALID'; return r; }
    const segUrl = new URL(seg, mediaUrl).toString();
    const s = await get(segUrl, { Range: 'bytes=0-4095' });
    r.firstSegment = { url: segUrl, status: s.res.status, contentType: s.res.headers.get('content-type'), cors: s.res.headers.get('access-control-allow-origin') };
    await s.res.body?.cancel().catch(() => {});
    if (!s.res.ok) r.failure = 'SEGMENT_HTTP_ERROR';
    else if (r.ajnRoute === 'direct' && !r.cors) r.failure = 'CORS_MISSING';
    else if (!r.codecs) r.failure = 'CODEC_UNKNOWN';
  } catch (e: any) {
    r.failure = e?.failure ?? (e?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK');
    r.detail = String(e?.message ?? e);
  } finally { r.ms = Date.now() - t0; }
  return r;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function main() {
  const channels: { name: string; group: string; url: string }[] = [];
  for (const src of DEFAULT_LIVE_SOURCES) {
    try {
      const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
      const t = await r.text();
      const got = parseM3uEntries(t).filter((e) => !checkLiveUrl(e.url) && !/\b(xxx|adult)\b/i.test(e.groupTitle ?? ''))
        .map((e) => ({ name: e.title.trim(), group: (e.groupTitle || 'Undefined').split(';')[0], url: e.url }));
      console.log(`${src}: ${got.length} usable entries`);
      channels.push(...got);
    } catch (e: any) { console.log(`${src}: FAILED ${e?.message}`); }
  }
  // Spread the sample across providers, then across groups within each.
  const byProv = new Map<string, typeof channels>();
  for (const c of channels) { const p = provider(c.url); if (!byProv.has(p)) byProv.set(p, []); byProv.get(p)!.push(c); }
  const provs = [...byProv.keys()].sort((a, b) => byProv.get(b)!.length - byProv.get(a)!.length);
  const sample: typeof channels = [];
  const seenGroup = new Set<string>();
  for (let round = 0; sample.length < COUNT && round < 50; round++) {
    for (const p of provs) {
      if (sample.length >= COUNT) break;
      const list = byProv.get(p)!;
      const pick = list.find((c) => !sample.includes(c) && !seenGroup.has(`${p}|${c.group}`)) ?? list.find((c) => !sample.includes(c));
      if (pick) { sample.push(pick); seenGroup.add(`${p}|${pick.group}`); }
    }
  }
  console.log(`probing ${sample.length} channels from ${provs.length} providers...`);
  const results = await pool(sample, 4, probe);

  if (RECHECK) {
    console.log('waiting 15 minutes for the recheck (Ctrl+C keeps nothing; results are written at the end)...');
    await new Promise((ok) => setTimeout(ok, 15 * 60_000));
    await pool(results, 4, async (r) => {
      const again = await probe({ name: r.channel, group: r.group, url: r.url });
      let segmentStatus: number | null = null;
      if (r.firstSegment) { try { const s = await get(r.firstSegment.url, { Range: 'bytes=0-4095' }); segmentStatus = s.res.status; await s.res.body?.cancel().catch(() => {}); } catch { segmentStatus = null; } }
      // Worked at first, refused now = the URL's token/session expired.
      const expired = !r.failure && (again.manifestStatus === 401 || again.manifestStatus === 403 || segmentStatus === 401 || segmentStatus === 403);
      r.recheck15m = { manifestStatus: again.manifestStatus, segmentStatus, failure: expired ? 'TOKEN_EXPIRED' : again.failure };
    });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'live-tv-probe.json'), JSON.stringify({ probedAt: new Date().toISOString(), origin: ORIGIN, results }, null, 2));
  const cols = ['channel', 'provider', 'group', 'ajnRoute', 'manifestStatus', 'redirects', 'cors', 'manifest', 'variantStatus', 'codecs', 'resolution', 'segmentStatus', 'segmentType', 'segmentCors', 'ms', 'failure', 'recheckManifest', 'recheckOldSegment', 'recheckFailure', 'detail', 'url'];
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = results.map((r) => [r.channel, r.provider, r.group, r.ajnRoute, r.manifestStatus, r.redirects.map((h) => `${h.status}>${new URL(h.url).hostname}`).join(' '), r.cors, r.manifest, r.variantStatus, r.codecs, r.resolution,
    r.firstSegment?.status, r.firstSegment?.contentType, r.firstSegment?.cors, r.ms, r.failure ?? 'OK', r.recheck15m?.manifestStatus, r.recheck15m?.segmentStatus, r.recheck15m?.failure, r.detail, r.url].map(esc).join(','));
  fs.writeFileSync(path.join(OUT, 'live-tv-probe.csv'), [cols.join(','), ...rows].join('\n'));

  const tally = new Map<string, number>();
  for (const r of results) tally.set(`${r.provider}: ${r.failure ?? 'OK'}`, (tally.get(`${r.provider}: ${r.failure ?? 'OK'}`) ?? 0) + 1);
  console.log('\nSummary');
  for (const [k, v] of [...tally].sort()) console.log(`  ${k.padEnd(40)} ${v}`);
  console.log(`\nWritten: ${path.join(path.resolve(OUT), 'live-tv-probe.csv')} (+ .json)`);
  const hardFail = results.filter((r) => r.failure && r.failure !== 'CODEC_UNKNOWN').length;
  process.exit(results.length === 0 ? 2 : hardFail === results.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
