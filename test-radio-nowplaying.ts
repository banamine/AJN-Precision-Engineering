import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fetchNowPlaying, stripJsonp, parseIhrTitle, httpIcyReader, STALE_AFTER_S, type TextFetcher, type IcyReader } from './server/radioNowPlaying.ts';
const NOW = Date.parse('2026-10-14T23:10:00Z');
const np = fs.readFileSync('fixtures-radio/CFMIFM_np.js', 'utf8'), pl = fs.readFileSync('fixtures-radio/CFMIFM_pl.js', 'utf8');
const mk = (over: Record<string, { status?: number; text?: string; lm?: string | null; throws?: boolean }> = {}): TextFetcher => async (url) => {
  const k = url.endsWith('_np.js') ? 'np' : 'pl'; const o = over[k] ?? {};
  if (o.throws) throw new Error('boom');
  return { status: o.status ?? 200, text: o.text ?? (k === 'np' ? np : pl), lastModified: o.lm === undefined ? 'Wed, 14 Oct 2026 23:09:48 GMT' : o.lm };
};
const cfg = { kind: 'corus-s3' as const, code: 'CFMIFM' };
(async () => {
  // real captured station files
  const r = await fetchNowPlaying(cfg, mk(), NOW);
  assert.equal(r.state, 'ok'); assert.equal(r.current?.artist, 'Cheap Trick'); assert.equal(r.current?.title, 'I Want You To Want Me');
  assert.ok(r.current?.artUrl?.startsWith('https://is5-ssl.mzstatic.com/')); assert.equal(r.ageSeconds, 12); assert.equal(r.source, 'station');
  assert.ok(r.recent.length >= 5 && r.recent[1].artist === 'The Tragically Hip');
  assert.equal(r.recent.find((s) => s.title.startsWith('When Something Stands'))?.artUrl, null, 'empty image stays null, never invented');
  // staleness is reported, not hidden
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { lm: 'Wed, 14 Oct 2026 22:00:00 GMT' } }), NOW)).state, 'stale');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { lm: null } }), NOW)).ageSeconds, null);
  // failures are explicit states
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { status: 404, text: '' } }), NOW)).state, 'none');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { status: 500, text: '' } }), NOW)).state, 'error');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { throws: true } }), NOW)).state, 'error');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { text: '<html>oops</html>' } }), NOW)).state, 'error');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { text: 'cb({"artist_name":"","song_name":""})' } }), NOW)).state, 'none');
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { text: 'x'.repeat(70000) } }), NOW)).state, 'error');
  // recent list failing does not hide the current song
  const r2 = await fetchNowPlaying(cfg, mk({ pl: { status: 500, text: '' } }), NOW); assert.equal(r2.state, 'ok'); assert.equal(r2.recent.length, 0);
  assert.equal((await fetchNowPlaying(cfg, mk({ pl: { throws: true } }), NOW)).state, 'ok');
  // hostile content: markup stripped, wrong image hosts and http dropped, JSONP never executed
  const evil = 'cb({"artist_name":"<img src=x onerror=alert(1)>AC&amp;DC","song_name":"T<script>x</script>nt","itunes_img":"http://evil.example/a.jpg"})';
  const e = await fetchNowPlaying(cfg, mk({ np: { text: evil } }), NOW);
  assert.ok(!/[<>]/.test(e.current!.artist + e.current!.title)); assert.equal(e.current!.artist, 'AC&DC'); assert.equal(e.current!.artUrl, null);
  assert.equal((await fetchNowPlaying(cfg, mk({ np: { text: 'cb({"artist_name":"A","song_name":"B","itunes_img":"https://evil.example/mzstatic.com/x.jpg"})' } }), NOW)).current!.artUrl, null);
  assert.throws(() => stripJsonp('alert(1);fetch("x")//'), /not a JSONP|Unexpected/);
  // station code is validated, URL never built from anything else
  for (const bad of ['', 'cf', '../x', 'CFMI/../../x', 'CFMIFM?x=1', 'a'.repeat(13)]) assert.equal((await fetchNowPlaying({ kind: 'corus-s3', code: bad }, mk(), NOW)).state, 'error', bad);
  let seen = ''; await fetchNowPlaying(cfg, async (u) => { seen += u + '\n'; return { status: 404, text: '', lastModified: null }; }, NOW);
  assert.ok(seen.split('\n').filter(Boolean).every((u) => u.startsWith('https://globalnewselection.s3.amazonaws.com/fm-playlist/results/CFMIFM_')));
  assert.equal(STALE_AFTER_S, 1200);
  // ---- Triton adapter
  const tx = (title: string, artist: string, start: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><nowplaying-info-list><nowplaying-info mountName="CJADAM" timestamp="${start}" type="track"><property name="cue_title"><![CDATA[${title}]]></property><property name="track_artist_name"><![CDATA[${artist}]]></property><property name="cue_time_start"><![CDATA[${start}]]></property><property name="cue_time_duration"><![CDATA[180000]]></property></nowplaying-info></nowplaying-info-list>`;
  const tcfg = { kind: 'triton' as const, mount: 'CJADAM' };
  const tf = (text: string, status = 200): TextFetcher => async () => ({ status, text, lastModified: null });
  const t1 = await fetchNowPlaying(tcfg, tf(tx('Song A', 'Band B', NOW - 30_000)), NOW);
  assert.equal(t1.state, 'ok'); assert.equal(t1.current?.title, 'Song A'); assert.equal(t1.current?.artist, 'Band B'); assert.equal(t1.current?.artUrl, null); assert.equal(t1.ageSeconds, 30);
  assert.equal((await fetchNowPlaying(tcfg, tf(tx('Old', 'X', NOW - 3_600_000)), NOW)).state, 'stale');
  assert.equal((await fetchNowPlaying(tcfg, tf(tx('', '', NOW)), NOW)).state, 'none');
  assert.equal((await fetchNowPlaying(tcfg, tf('<html>nope</html>'), NOW)).state, 'error');
  assert.equal((await fetchNowPlaying(tcfg, tf('', 500), NOW)).state, 'error');
  const th = await fetchNowPlaying(tcfg, tf(tx('<b>T</b><script>x</script>', 'A&amp;B', NOW)), NOW);
  assert.ok(!/[<>]/.test(th.current!.title)); assert.equal(th.current!.artist, 'A&B');
  for (const bad of ['', 'ab', '../x', 'CJAD&x=1', 'CJAD/../x', 'a'.repeat(41)]) assert.equal((await fetchNowPlaying({ kind: 'triton', mount: bad }, tf(tx('a', 'b', NOW)), NOW)).state, 'error', bad);
  let tu = ''; await fetchNowPlaying(tcfg, async (u) => { tu = u; return { status: 404, text: '', lastModified: null }; }, NOW);
  assert.equal(tu, 'https://np.tritondigital.com/public/nowplaying?mountName=CJADAM&numberToFetch=1&eventType=track');
  // ---- Route service: map-only ids, cache, single-flight, no failure caching
  const { createNowPlayingService, NOW_PLAYING_STATIONS, CACHE_MS } = await import('./server/radioNowPlayingRoute.ts');
  let calls = 0, clock = NOW, mode: 'ok' | 'fail' = 'ok';
  const svc = createNowPlayingService(async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return mode === 'ok' ? { status: 200, text: tx('S', 'A', clock), lastModified: null } : { status: 500, text: '', lastModified: null }; }, () => clock);
  const id = 'radio:ca-cjad';
  await Promise.all([svc(id), svc(id), svc(id)]); assert.equal(calls, 1, 'single-flight');
  await svc(id); assert.equal(calls, 1, 'cached');
  clock += CACHE_MS + 1; await svc(id); assert.equal(calls, 2, 'cache expires');
  mode = 'fail'; clock += CACHE_MS + 1; assert.equal((await svc(id)).state, 'error'); const c3 = calls; await svc(id); assert.equal(calls, c3 + 1, 'failure not cached');
  for (const bad of ['radio:unknown', '', '__proto__', 'constructor', 'http://evil/x', 'radio:ca-cjad/../x']) assert.equal((await svc(bad)).state, 'unsupported', bad);
  assert.equal(Object.keys(NOW_PLAYING_STATIONS).length, 532);
  assert.deepEqual(NOW_PLAYING_STATIONS['radio:ca-cjad'], { kind: 'triton', mount: 'CJADAM' });
  // ---- non-song filter
  const ns = async (cf: any, art: string, ti: string) => (await fetchNowPlaying(cf, cf.kind === 'triton' ? tf(tx(ti, art, NOW)) : tf(l3b(ti, art)), NOW)).state;
  const l3b = (ti: string, ar: string) => JSON.stringify({ 'current-track': { title: ti, artist: ar, start: '2026-10-14 23:09:00+00:00' } });
  assert.equal(await ns(tcfg, '', 'Liveline With Mason - 104.7 KCLD'), 'none');
  assert.equal(await ns(tcfg, '89.3 WRKF Baton Rouge wrkf.org', '89.3 WRKF Baton Rouge wrkf.org'), 'none');
  assert.equal(await ns(tcfg, 'KNPR', 'News 88.9 KNPR'), 'none');
  assert.equal(await ns({ kind: 'live365', mount: 'a33394' }, 'Live365', '120 Second Ad Break'), 'none');
  assert.equal(await ns(tcfg, 'Demi Lovato', 'Give Your Heart A Break'), 'ok', 'real songs with "break" survive');
  assert.equal(await ns(tcfg, 'The Doors', 'Break On Through (To The Other Side)'), 'ok');
  assert.equal(await ns(tcfg, '2025-12-8 08:26:07', 'bit1064'), 'none');
  assert.equal((await fetchNowPlaying(tcfg, tf(tx('Say It Isn&apos;t So', 'Weezer &amp; Co', NOW)), NOW)).current?.title, "Say It Isn't So");
  // ---- SomaFM
  const somaJ = (o: object) => JSON.stringify({ id: 'x', songs: [o] });
  const sc = { kind: 'somafm' as const, channel: 'groovesalad' };
  const sr = await fetchNowPlaying(sc, tf(somaJ({ title: 'Night Wind', artist: 'Gold Lounge', albumArt: 'http://evil/x.jpg', date: String(Math.floor(NOW / 1000) - 60) })), NOW);
  assert.equal(sr.state, 'ok'); assert.equal(sr.current?.title, 'Night Wind'); assert.equal(sr.current?.artUrl, null); assert.equal(sr.ageSeconds, 60);
  assert.equal((await fetchNowPlaying(sc, tf(somaJ({ title: 'Old', artist: 'A', date: '1000' })), NOW)).state, 'stale');
  assert.equal((await fetchNowPlaying(sc, tf(somaJ({ title: '', artist: 'A', date: '1' })), NOW)).state, 'none');
  assert.equal((await fetchNowPlaying(sc, tf('not json'), NOW)).state, 'error');
  assert.equal((await fetchNowPlaying(sc, tf('{}', 500), NOW)).state, 'error');
  for (const bad of ['', '../x', 'A_B', 'a'.repeat(31)]) assert.equal((await fetchNowPlaying({ kind: 'somafm', channel: bad }, tf(somaJ({})), NOW)).state, 'error', bad);
  // ---- Live365
  const l3 = (t: object) => JSON.stringify({ 'mount-id': 'a33394', 'current-track': t });
  const lc = { kind: 'live365' as const, mount: 'a33394' };
  const lr = await fetchNowPlaying(lc, tf(l3({ title: 'Song', artist: 'Band', art: 'https://media.live365.com/download/x.jpg', start: '2026-10-14 23:09:00.00+00:00' })), NOW);
  assert.equal(lr.state, 'ok'); assert.equal(lr.current?.artUrl, 'https://media.live365.com/download/x.jpg'); assert.equal(lr.ageSeconds, 60);
  assert.equal((await fetchNowPlaying(lc, tf(l3({ title: 'S', artist: 'B', art: 'https://broadcaster.live365.com/static/assets/img/blankart.jpg', start: '2026-10-14 23:09:00+00:00' })), NOW)).current?.artUrl, null, 'placeholder art dropped');
  assert.equal((await fetchNowPlaying(lc, tf(l3({ title: 'S', artist: 'B', art: 'https://evil.example/media.live365.com/x.jpg', start: '2026-10-14 23:09:00+00:00' })), NOW)).current?.artUrl, null);
  assert.equal((await fetchNowPlaying(lc, tf(l3({ title: '', artist: '' })), NOW)).state, 'none');
  for (const bad of ['', 'x33394', 'a1', '../a33394']) assert.equal((await fetchNowPlaying({ kind: 'live365', mount: bad }, tf(l3({})), NOW)).state, 'error', bad);
  // ---- iHeart inline meta
  const ic = (title: string | null, status = 200): IcyReader => async () => ({ status, streamTitle: title });
  const hc = { kind: 'ihr' as const, stream: 'zc2069' };
  const music = ` Kings Of Leon - text="Use Somebody" song_spot="M" MediaBaseId="1" TAID="2" amgArtworkURL="" `;
  const hr = await fetchNowPlaying(hc, tf(''), NOW, 6000, ic(music));
  assert.equal(hr.state, 'ok'); assert.equal(hr.current?.artist, 'Kings Of Leon'); assert.equal(hr.current?.title, 'Use Somebody');
  const ad = ` - text="IHC-RBHH-GUARANTEED HUMAN" song_spot="T" spotInstanceId="-1" length="00:00:04" `;
  assert.equal((await fetchNowPlaying(hc, tf(''), NOW, 6000, ic(ad))).state, 'none', 'ads and IDs never shown as songs');
  assert.equal((await fetchNowPlaying(hc, tf(''), NOW, 6000, ic('plain text'))).state, 'none');
  assert.equal((await fetchNowPlaying(hc, tf(''), NOW, 6000, ic(null))).state, 'error');
  assert.equal((await fetchNowPlaying(hc, tf(''), NOW, 6000, ic('', 403))).state, 'error');
  const hx = await fetchNowPlaying(hc, tf(''), NOW, 6000, ic(` <b>A</b> - text="T<script>x</script>" song_spot="M" `)); assert.ok(!/[<>]/.test(hx.current!.artist + hx.current!.title));
  for (const bad of ['', 'zc', '../zc1', 'zc1/../x', 'ZC1']) assert.equal((await fetchNowPlaying({ kind: 'ihr', stream: bad }, tf(''), NOW, 6000, ic(music))).state, 'error', bad);
  let iu = ''; await fetchNowPlaying(hc, tf(''), NOW, 6000, async (u) => { iu = u; return { status: 404, streamTitle: null }; });
  assert.equal(iu, 'https://stream.revma.ihrhls.com/zc2069');
  assert.equal(parseIhrTitle('no markers'), null);
  // ---- real Icy framing against a local fake stream
  const META = `StreamTitle='${music}';`; const pad = Buffer.alloc(Math.ceil(META.length / 16) * 16); pad.write(META);
  const srv = http.createServer((q, r) => { const mi = 1000; r.writeHead(200, { 'icy-metaint': String(mi), 'content-type': 'audio/aac' }); r.write(Buffer.alloc(mi, 1)); r.write(Buffer.from([pad.length / 16])); r.write(pad); const t = setInterval(() => r.write(Buffer.alloc(500, 2)), 20); r.on('close', () => clearInterval(t)); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const got = await httpIcyReader(`http://127.0.0.1:${(srv.address() as any).port}/s`, new AbortController().signal);
  assert.equal(got.status, 200); assert.equal(got.streamTitle, music);
  srv.closeAllConnections(); srv.close();
  const srv2 = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'audio/aac' }); r.end(Buffer.alloc(5000)); });
  await new Promise<void>((ok) => srv2.listen(0, '127.0.0.1', ok));
  assert.equal((await httpIcyReader(`http://127.0.0.1:${(srv2.address() as any).port}/s`, new AbortController().signal)).streamTitle, null, 'no icy-metaint -> null');
  srv2.closeAllConnections(); srv2.close();
  // ---- ICY concurrency cap through the service
  let cur = 0, peak = 0;
  const svc2 = createNowPlayingService(tf(''), () => NOW, async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 30)); cur--; return { status: 200, streamTitle: music }; });
  const ihrIds = Object.entries(NOW_PLAYING_STATIONS).filter(([, v]) => v.kind === 'ihr').map(([k]) => k).slice(0, 12);
  const outs = await Promise.all(ihrIds.map((i) => svc2(i))); assert.ok(outs.every((o) => o.state === 'ok')); assert.ok(peak <= 4 && peak >= 2, `peak ${peak}`);
  console.log('PASS radio-nowplaying');
})();
