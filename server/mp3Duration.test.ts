import assert from 'node:assert/strict';
import test from 'node:test';
import { clearProbeCacheForTests, parseMp3Duration, probeMp3Duration } from './mp3Duration';

// MPEG1 Layer III, 128 kbps, 44.1 kHz, stereo: header FF FB 90 00
const HDR = [0xff, 0xfb, 0x90, 0x00];
function xingFile(frames: number): Uint8Array {
  const b = new Uint8Array(2048); b.set(HDR, 0);
  b.set([0x58, 0x69, 0x6e, 0x67], 4 + 32); // "Xing"
  b.set([0, 0, 0, 1], 4 + 32 + 4); // flags: frames present
  b.set([(frames >>> 24) & 255, (frames >>> 16) & 255, (frames >>> 8) & 255, frames & 255], 4 + 32 + 8);
  return b;
}
function id3(tagBytes: number, then: Uint8Array): Uint8Array {
  const head = new Uint8Array(10 + tagBytes); head.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, (tagBytes >> 7) & 0x7f, tagBytes & 0x7f]);
  const out = new Uint8Array(head.length + then.length); out.set(head); out.set(then, head.length); return out;
}

test('Xing header: frames x 1152 / 44100', () => {
  const r = parseMp3Duration(xingFile(137_813)); // 137813 * 1152 / 44100 = 3600.0 s
  assert.deepEqual(r, { seconds: 3600, method: 'xing' });
});
test('ID3v2 tag is skipped before the first frame', () => {
  const r = parseMp3Duration(id3(300, xingFile(38_281)));
  assert.equal(r?.method, 'xing'); assert.equal(r?.seconds, 1000);
});
test('CBR without a VBR header: size-based estimate, only when the total size is known', () => {
  const b = new Uint8Array(2048); b.set(HDR, 0);
  assert.equal(parseMp3Duration(b), null, 'no total size: refuse to guess');
  const r = parseMp3Duration(b, 16_000_000); // 128 kbps: 16e6*8/128000 = 1000 s
  assert.equal(r?.method, 'cbr-estimate'); assert.ok(Math.abs((r?.seconds ?? 0) - 1000) <= 1);
});
test('garbage and empty input return null', () => {
  assert.equal(parseMp3Duration(new Uint8Array(0)), null);
  assert.equal(parseMp3Duration(new Uint8Array(4096).fill(7)), null);
});
test('probe: bounded Range request, 206 body parsed, cached per key', async () => {
  clearProbeCacheForTests();
  let calls = 0; let range = '';
  const f = (async (_u: unknown, init?: RequestInit) => { calls++; range = String((init?.headers as Record<string, string>).Range);
    return new Response(xingFile(137_813), { status: 206, headers: { 'content-range': 'bytes 0-2047/90000000' } }); }) as unknown as typeof fetch;
  assert.equal(await probeMp3Duration('g1', 'https://media.example/a.mp3', f), 3600);
  assert.equal(await probeMp3Duration('g1', 'https://media.example/a.mp3', f), 3600);
  assert.equal(calls, 1); assert.equal(range, 'bytes=0-262143');
});
test('probe: failing URL returns null and is cached; SSRF-blocked host is never fetched', async () => {
  clearProbeCacheForTests();
  const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await probeMp3Duration('g2', 'https://media.example/b.mp3', bad), null);
  let called = false;
  const spy = (async () => { called = true; return new Response('x'); }) as unknown as typeof fetch;
  assert.equal(await probeMp3Duration('g3', 'http://127.0.0.1/a.mp3', spy), null);
  assert.equal(called, false);
});
