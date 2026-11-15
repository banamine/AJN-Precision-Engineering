// Offline tests for the TV News caption feature. Synthetic text only. Zero archive.org requests.
import assert from 'node:assert/strict';
import {
  parseSrt, pickCaptionFile, isTvNewsId, validSliceStart, captionSliceUrl, toProgramTime, retryAfterSeconds, KIND_LABEL,
} from './server/captions/captionCore.ts';
import { createCaptionService, UPSTREAM_MIN_GAP_MS, type ServiceFail } from './server/captions/captionService.ts';
import {
  parseProgramRef, wantedSlices, SliceStore, visibleLines, RequestBudget, sliceStartFor,
} from './src/news/captions/captionTrack.ts';

let n = 0; const ok = (name: string) => { n += 1; console.log(`ok ${n} ${name}`); };

// ---- core ----
{
  const cues = parseSrt('1\r\n00:00:03,000 --> 00:00:04,500\r\n<i>alpha</i> beta\r\n\r\n2\r\n00:01:00.250 --> 00:01:01.000\r\ngamma\r\n\r\ngarbage\r\n\r\n3\r\n00:00:09,000 --> 00:00:08,000\r\nbackwards');
  assert.deepEqual(cues, [{ start: 3, end: 4.5, text: 'alpha beta' }, { start: 60.25, end: 61, text: 'gamma' }]);
  ok('parseSrt handles CRLF, dot decimals, tags; drops malformed and backwards cues');
}
{
  const id = 'FOXNEWSW_20261016_030000_Fox_News_at_Night';
  const files = (...s: string[]) => s.map((x) => ({ name: `${id}.${x}.srt` }));
  assert.equal(pickCaptionFile(id, [...files('asr', 'cc5', 'align')])?.suffix, 'align');
  assert.equal(pickCaptionFile(id, [...files('asr', 'cc5')])?.kind, 'broadcast-cc');
  assert.equal(pickCaptionFile(id, files('asr'))?.kind, 'asr');
  assert.equal(pickCaptionFile(id, [{ name: `${id}.mp4` }, { name: `${id}_meta.xml` }]), null);
  assert.equal(pickCaptionFile(id, [{ name: `OTHER.${'asr'}.srt` }]), null);
  assert.ok(KIND_LABEL.asr.includes('not broadcaster captions'));
  ok('pickCaptionFile priority align > cc5 > asr > none; kinds labelled; other items ignored');
}
{
  assert.ok(isTvNewsId('ALJAZ_20261017_050000'));
  assert.ok(isTvNewsId('DW_20261015_110200_DW_News_Focus'));
  for (const bad of ['', 'x', '../etc/passwd', 'FOX_2026_03', 'FOXNEWSW_20261016_030000/../x', 'A_20261016_030000_a b', 42, null, undefined]) assert.equal(isTvNewsId(bad as any), false, String(bad));
  assert.ok(validSliceStart(0) && validSliceStart(60) && validSliceStart(14400));
  for (const bad of [-60, 30, 61, 14460, 1.5, NaN, '60' as any, null as any]) assert.equal(validSliceStart(bad), false, String(bad));
  assert.equal(captionSliceUrl('ALJAZ_20261017_050000', 'asr', 120), 'https://archive.org/download/ALJAZ_20261017_050000/ALJAZ_20261017_050000.asr.srt?t=120/180');
  ok('identifier and slice-start validation; upstream URL is exactly the Archive player form');
}
{
  const raw = [{ start: 3, end: 4, text: 'a' }, { start: 59, end: 61, text: 'b' }];
  const rel = toProgramTime(raw, 60);
  assert.equal(rel.timeBase, 'relative'); assert.deepEqual(rel.cues.map((c) => c.start), [63, 119]);
  const abs = toProgramTime([{ start: 121, end: 122, text: 'a' }, { start: 150, end: 151, text: 'b' }], 120);
  assert.equal(abs.timeBase, 'absolute'); assert.deepEqual(abs.cues.map((c) => c.start), [121, 150]);
  assert.deepEqual(toProgramTime(raw, 0).cues.map((c) => c.start), [3, 59]);
  assert.deepEqual(toProgramTime([], 60), { cues: [], timeBase: 'relative' });
  ok('cue times: relative slices are shifted, absolute slices are detected and not shifted');
}
{
  assert.equal(retryAfterSeconds('7', 0), 7); assert.equal(retryAfterSeconds('9999', 0), 120); assert.equal(retryAfterSeconds(null, 0), 30);
  assert.equal(retryAfterSeconds(new Date(10_000).toUTCString(), 0), 10);
  ok('Retry-After parsing: seconds, date, missing, capped');
}

// ---- client logic ----
{
  const p = parseProgramRef('/download/CNNW_20261016_030000_Newsroom/CNNW_20261016_030000_Newsroom.mp4?exact=1&start=282&end=564');
  assert.deepEqual(p, { id: 'CNNW_20261016_030000_Newsroom', clipStart: 282 });
  assert.deepEqual(parseProgramRef('/download/CNNW_20261016_030000_X/CNNW_20261016_030000_X.mp4'), { id: 'CNNW_20261016_030000_X', clipStart: 0 });
  for (const bad of [undefined, null, '', '/download/some-song/some-song.mp3', '/download/CNNW_20261016_030000_A/OTHER.mp4?start=1', '/api/archive/proxy?path=x', 'https://evil.example/download/A_20261016_030000/A_20261016_030000.mp4']) assert.equal(parseProgramRef(bad as any), null, String(bad));
  ok('parseProgramRef: only TV News clip paths; anything else is null (panel off, zero requests)');
}
{
  assert.equal(sliceStartFor(0), 0); assert.equal(sliceStartFor(59.9), 0); assert.equal(sliceStartFor(60), 60); assert.equal(sliceStartFor(564.2), 540);
  assert.deepEqual(wantedSlices(10), [0]); assert.deepEqual(wantedSlices(30), [0, 60]); assert.deepEqual(wantedSlices(91), [60, 120]);
  assert.deepEqual(wantedSlices(30, 60), [0]);
  // hand-off between 282 s windows: window 1 starts at 282 s, so 5 s into it is programme second 287
  assert.equal(sliceStartFor(282 + 5), 240); assert.deepEqual(wantedSlices(282 + 5), [240, 300]); // 47 s into slice 240: next one is wanted too
  assert.deepEqual(wantedSlices(262), [240]);
  ok('slice planning, prefetch one ahead, window hand-off maths (segment*282 + currentTime)');
}
{
  const s = new SliceStore();
  s.put(0, [{ start: 59, end: 61, text: 'edge' }, { start: 5, end: 6, text: 'one' }]);
  s.put(60, [{ start: 59, end: 61, text: 'edge' }, { start: 62, end: 63, text: 'two' }]);
  assert.deepEqual(s.cues().map((c) => c.text), ['one', 'edge', 'two']);
  s.put(120, []); s.put(180, []); s.prune(200);
  assert.equal(s.has(0), false); assert.equal(s.has(60), false); assert.equal(s.has(120), true);
  s.clear(); assert.equal(s.size(), 0);
  ok('SliceStore de-duplicates the cue that straddles two slices and prunes behind the playhead');
}
{
  const cues = [{ start: 1, end: 3, text: 'a' }, { start: 5, end: 6, text: 'b' }, { start: 20, end: 21, text: 'c' }];
  assert.deepEqual(visibleLines(cues, 0.5, 'broadcast-cc'), { current: null, before: [] });
  assert.equal(visibleLines(cues, 2, 'asr').current?.text, 'a');
  assert.equal(visibleLines(cues, 5.5, 'asr').current?.text, 'b');
  assert.deepEqual(visibleLines(cues, 5.5, 'asr').before.map((c) => c.text), ['a']);
  const quiet = visibleLines(cues, 15, 'asr');
  assert.equal(quiet.current, null); assert.equal(quiet.before.at(-1)?.text, 'b');
  ok('visibleLines: current line, history, and a quiet gap shows no stale line');
}
{
  const b = new RequestBudget(3, 5);
  for (let i = 0; i < 3; i += 1) { assert.ok(b.canRequest(i)); b.record(i); }
  assert.equal(b.canRequest(10), false);
  assert.ok(b.canRequest(60_001)); b.record(60_001); b.record(60_002);
  assert.equal(b.canRequest(120_000), false); // session cap 5 reached
  ok('RequestBudget: per-minute window and per-session cap');
}

// ---- service with a fake Archive ----
const ALLOWED = new Set(['FOXNEWSW', 'ALJAZ', 'DW']);
const ID = 'ALJAZ_20261015_140000';
type Reply = { status: number; body?: string; headers?: Record<string, string> };
function harness(handler: (url: string, n: number) => Reply) {
  let clock = 1_000_000; const urls: string[] = []; const sent: Array<Record<string, string>> = []; const sleeps: number[] = [];
  const fetchImpl = (async (input: any, init?: any) => {
    const url = String(input); urls.push(url); sent.push({ ...(init?.headers ?? {}) });
    const r = handler(url, urls.length);
    return new Response(r.status === 204 ? null : (r.body ?? ''), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  const svc = createCaptionService({ fetchImpl, allowedNetworks: ALLOWED, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  return { svc, urls, sent, sleeps, advance: (ms: number) => { clock += ms; } };
}
const meta = (names: string[]) => JSON.stringify({ files: names.map((name) => ({ name })) });
const SRT = '1\n00:00:02,000 --> 00:00:03,000\nsynthetic one\n\n2\n00:00:10,000 --> 00:00:12,000\nsynthetic two\n';

(async () => {
  { // plan: priority, caching, single-flight, validation with zero upstream
    const h = harness(() => ({ status: 200, body: meta([`${ID}.asr.srt`, `${ID}.cc5.srt`, `${ID}.mp4`]) }));
    const [a, b] = await Promise.all([h.svc.plan(ID), h.svc.plan(ID)]);
    assert.ok(a.ok && b.ok && a.value.source === 'cc5'); assert.equal(h.urls.length, 1);
    const c = await h.svc.plan(ID); assert.ok(c.ok); assert.equal(h.urls.length, 1);
    assert.deepEqual(h.urls, [`https://archive.org/metadata/${ID}`]);
    for (const bad of ['', '../x', 'NOPE_20261015_140000', 'CNBC_20261015_140000']) {
      const r = await h.svc.plan(bad); assert.ok(!r.ok && (r as ServiceFail).status === 400, bad);
    }
    assert.equal(h.urls.length, 1);
    ok('service.plan: cc5 chosen over asr, one metadata request for concurrent+repeat calls, bad/unsupported ids rejected with zero requests');
  }
  { // plan none is a real answer and is reported, not hidden
    const h = harness(() => ({ status: 200, body: meta([`${ID}.mp4`, `${ID}_meta.xml`]) }));
    const r = await h.svc.plan(ID); assert.ok(r.ok && r.value.source === 'none');
    ok('service.plan: no caption file -> source "none"');
  }
  { // slice: parse + offset + URL + no credentials sent
    const h = harness(() => ({ status: 200, body: SRT }));
    const r = await h.svc.slice(ID, 'asr', 60);
    assert.ok(r.ok); assert.deepEqual(r.value.cues.map((c) => c.start), [62, 70]); assert.equal(r.value.timeBase, 'relative'); assert.equal(r.value.kind, 'asr');
    assert.equal(h.urls[0], `https://archive.org/download/${ID}/${ID}.asr.srt?t=60/120`);
    for (const hd of h.sent) { assert.deepEqual(Object.keys(hd).map((k) => k.toLowerCase()).sort(), ['accept', 'user-agent']); }
    ok('service.slice: exact upstream URL, times shifted to programme time, no cookie/authorization headers');
  }
  { // empty body is reported as empty and never cached as success
    const h = harness(() => ({ status: 200, body: '' }));
    const a = await h.svc.slice(ID, 'cc5', 0); const b = await h.svc.slice(ID, 'cc5', 0);
    assert.ok(a.ok && a.value.empty && b.ok && b.value.empty); assert.equal(h.urls.length, 2);
    ok('service.slice: empty body -> empty:true, not cached');
  }
  { // 429: exactly one upstream request, cooldown honoured, resumes afterwards, no retry
    const h = harness((_u, n) => n === 1 ? { status: 429, headers: { 'retry-after': '7' } } : { status: 200, body: SRT });
    const a = await h.svc.slice(ID, 'asr', 0);
    assert.ok(!a.ok && (a as ServiceFail).status === 429 && (a as ServiceFail).retryAfter === 7); assert.equal(h.urls.length, 1);
    const b = await h.svc.slice(ID, 'asr', 60); assert.ok(!b.ok && (b as ServiceFail).status === 429); assert.equal(h.urls.length, 1);
    const p = await h.svc.plan(ID); assert.ok(!p.ok && (p as ServiceFail).status === 429); assert.equal(h.urls.length, 1);
    h.advance(8_000);
    const c = await h.svc.slice(ID, 'asr', 60); assert.ok(c.ok); assert.equal(h.urls.length, 2);
    ok('service: 429 + Retry-After 7 -> 1 upstream request, 0 during cooldown (slice and plan), resumes after 8 s');
  }
  for (const [status, error, code] of [[403, 'caption_forbidden', 403], [404, 'caption_file_not_found', 404], [500, 'archive_upstream_error', 502], [503, 'archive_upstream_error', 502]] as const) {
    const h = harness(() => ({ status }));
    const r = await h.svc.slice(ID, 'asr', 0);
    assert.ok(!r.ok && (r as ServiceFail).error === error && (r as ServiceFail).status === code); assert.equal(h.urls.length, 1);
  }
  ok('service.slice: 403/404/5xx are explicit errors with exactly one request (no retry, no workaround)');
  { // redirects: archive host followed, foreign host refused before any request
    const good = harness((u) => u.includes('/download/ALJAZ') && !u.includes('ia800') ? { status: 302, headers: { location: `https://ia800000.us.archive.org/1/items/${ID}/${ID}.asr.srt?t=0/60` } } : { status: 200, body: SRT });
    const g = await good.svc.slice(ID, 'asr', 0); assert.ok(g.ok); assert.equal(good.urls.length, 2);
    const evil = harness(() => ({ status: 302, headers: { location: 'https://evil.example/steal' } }));
    const e = await evil.svc.slice(ID, 'asr', 0); assert.ok(!e.ok && (e as ServiceFail).error === 'archive_unreachable');
    assert.equal(evil.urls.length, 1); assert.ok(!evil.urls.some((u) => u.includes('evil.example')));
    const http = harness(() => ({ status: 302, headers: { location: 'http://archive.org/x' } }));
    const hh = await http.svc.slice(ID, 'asr', 0); assert.ok(!hh.ok); assert.equal(http.urls.length, 1);
    ok('service: redirects only to https archive.org hosts; foreign/http targets are never requested');
  }
  { // oversized body refused
    const h = harness(() => ({ status: 200, body: 'x'.repeat(300 * 1024) }));
    const r = await h.svc.slice(ID, 'asr', 0); assert.ok(!r.ok && (r as ServiceFail).error === 'slice_too_large');
    ok('service.slice: body over 256 KiB is refused');
  }
  { // spacing between upstream starts
    const h = harness(() => ({ status: 200, body: SRT }));
    await Promise.all([h.svc.slice(ID, 'asr', 0), h.svc.slice(ID, 'asr', 60), h.svc.slice(ID, 'asr', 120)]);
    assert.equal(h.urls.length, 3); assert.ok(h.sleeps.length >= 2);
    assert.ok(h.sleeps.every((ms) => ms >= UPSTREAM_MIN_GAP_MS - 1), JSON.stringify(h.sleeps));
    ok(`service: concurrent calls are spaced >= ${UPSTREAM_MIN_GAP_MS} ms apart`);
  }
  { // bad inputs never reach upstream
    const h = harness(() => ({ status: 200, body: SRT }));
    for (const [id, src, start] of [[ID, 'mp4', 0], [ID, 'asr', 30], [ID, 'asr', -60], [ID, '../asr', 0], ['../x', 'asr', 0]] as const) {
      const r = await h.svc.slice(id, src, start as any); assert.ok(!r.ok && (r as ServiceFail).status === 400, `${id} ${src} ${start}`);
    }
    assert.equal(h.urls.length, 0);
    ok('service.slice: bad source/start/id -> 400, zero upstream requests');
  }
})().then(() => console.log(`\n${n} checks passed`)).catch((e) => { console.error(e); process.exit(1); });
