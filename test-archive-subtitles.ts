import assert from 'node:assert/strict';
import express from 'express';
import { isEnglishSubtitleName, pickEnglishSrt, srtToVtt, registerArchiveSubtitleRoutes } from './server/archiveSubtitles.ts';
import { archiveSubtitleUrl } from './src/utils/archiveSubtitles.ts';

for (const n of ['M.1931.English.srt', '[English] M (1931).srt', 'movie.en.srt', 'movie_eng.srt', 'Movie (ENGLISH).srt']) assert.equal(isEnglishSubtitleName(n), true, n);
for (const n of ['movie.srt', 'movie.fr.srt', 'frenchmen.srt', 'movie.es.srt', 'Movie Russian.srt']) assert.equal(isEnglishSubtitleName(n), false, n);
assert.equal(pickEnglishSrt([{ name: 'M(1931)/M.1931.mp4' }, { name: 'M.1931.English.srt', size: '82432' }, { name: 'M.1931.French.srt' }], 'M(1931)/M.1931.mp4'), 'M.1931.English.srt');
assert.equal(pickEnglishSrt([{ name: 'x.fr.srt' }, { name: 'x.srt' }]), null, 'English only: unlabeled or other languages are never used');
assert.equal(pickEnglishSrt([{ name: 'big.English.srt', size: String(5 * 1024 * 1024) }]), null, 'oversized subtitle files are skipped');
const vtt = srtToVtt('﻿1\r\n00:00:01,500 --> 00:00:04,000\r\nHello\r\n\r\n2\r\n0:00:05,25 --> 0:00:06,000 X1:0\r\nTwo\r\nlines\r\n\r\n3\r\nbroken\r\n');
assert.equal(vtt, 'WEBVTT\n\n00:00:01.500 --> 00:00:04.000\nHello\n\n00:00:05.250 --> 00:00:06.000\nTwo\nlines\n');
assert.equal(archiveSubtitleUrl('/api/archive/proxy?path=%2Fdownload%2Fm.-1931%2FM(1931)%2FM.1931.mp4'), '/api/archive/subtitles?id=m.-1931&video=M(1931)%2FM.1931.mp4');
assert.equal(archiveSubtitleUrl('https://archive.org/download/m-commentary/m%201931%20w%20commentary.mp4'), '/api/archive/subtitles?id=m-commentary&video=m%201931%20w%20commentary.mp4');
assert.equal(archiveSubtitleUrl('https://example.com/a.mp4'), null);
console.log('PASS English-only selection, SRT→VTT conversion, source → subtitle URL');

let calls = 0;
const fake = (async (input: RequestInfo | URL) => {
  calls++;
  const u = String(input);
  if (u.includes('/metadata/m.-1931')) return Response.json({ files: [{ name: 'M(1931)/M.1931.mp4' }, { name: 'M.1931.English.srt', size: '40' }] });
  if (u.includes('/metadata/nosubs')) return Response.json({ files: [{ name: 'a.mp4' }, { name: 'a.de.srt' }] });
  if (u.endsWith('/download/m.-1931/M.1931.English.srt')) return new Response('1\n00:00:01,000 --> 00:00:02,000\nWarum?\n');
  return new Response('nope', { status: 404 });
}) as typeof fetch;
const app = express();
registerArchiveSubtitleRoutes(app, fake);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  const ok = await fetch(`${base}/api/archive/subtitles?id=m.-1931&video=M(1931)%2FM.1931.mp4`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /text\/vtt/);
  assert.equal(await ok.text(), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nWarum?\n');
  const before = calls;
  assert.equal((await fetch(`${base}/api/archive/subtitles?id=m.-1931&video=M(1931)%2FM.1931.mp4`)).status, 200);
  assert.equal(calls, before, 'second request served from cache');
  assert.equal((await fetch(`${base}/api/archive/subtitles?id=nosubs`)).status, 404);
  assert.equal((await fetch(`${base}/api/archive/subtitles?id=../etc`)).status, 400);
  assert.equal((await fetch(`${base}/api/archive/subtitles?id=missing`)).status, 502);
  console.log('PASS /api/archive/subtitles: 200 text/vtt, cached, 404 when no English file, 400 bad id, 502 upstream error');
} finally {
  server.close();
}
