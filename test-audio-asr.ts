import assert from 'node:assert/strict';
import express from 'express';
import { createInfowarsRadioStore, type InfowarsItemMetadata } from './server/infowarsRadio.ts';
import { createAudioAsrService, AUDIO_ASR_LABEL } from './server/audioAsr.ts';
import { registerAudioAsrRoutes } from './server/audioAsrRoutes.ts';

const id = 'The_Alex_Jones_Radio_Show_20261019_120000';
const noAsrId = 'The_Alex_Jones_Radio_Show_20261018_120000';
const audioOnlyMeta = (includeAsr: boolean): InfowarsItemMetadata => ({
  identifier: includeAsr ? id : noAsrId,
  files: [
    { name: `${includeAsr ? id : noAsrId}.m4a`, source: 'original', length: '3600', format: 'M4A', private: 'false' },
    ...(includeAsr ? [{ name: `${id}.m4a.asr.srt`, length: '100', private: 'false' }] : []),
    { name: `${includeAsr ? id : noAsrId}.hidden.asr.srt`, private: 'true' },
  ],
});
const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname.endsWith('/advancedsearch.php')) {
    return new Response(JSON.stringify({ response: { numFound: 2, docs: [{ identifier: id }, { identifier: noAsrId }] } }), { status: 200 });
  }
  if (url.pathname.startsWith('/metadata/')) {
    const which = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return new Response(JSON.stringify(audioOnlyMeta(which === id)), { status: 200 });
  }
  assert.match(url.search, /[?&]t=60\/120|[?&]t=0\/60/);
  return new Response('\uFEFF1\r\n00:00:12,500 --> 00:00:13,000\r\nDEMO synthetic only\r\n', { status: 200, headers: { 'content-type': 'text/plain' } });
};
const store = createInfowarsRadioStore({ fetchImpl, cacheDir: null });
const service = createAudioAsrService({
  fetchImpl,
  getCandidates: () => store.getCandidateSnapshot(),
  getMetadata: (which) => store.getItemMetadata(which),
  enabled: () => true,
});

const plan = await service.plan(id);
assert.equal(plan.source, 'asr');
assert.equal(plan.label, AUDIO_ASR_LABEL);
assert.equal(plan.file, `${id}.m4a.asr.srt`, 'file name comes from metadata, not the request');
const at0 = await service.slice(id, '0/60');
assert.deepEqual([at0.cues[0].start, at0.cues[0].end, at0.sliceStart], [12.5, 13, 0]);
const at60 = await service.slice(id, '60/60');
assert.deepEqual([at60.cues[0].start, at60.cues[0].end], [72.5, 73], 'relative 12.5 seconds + 60 = 72.5 absolute');
assert.equal(at60.source, 'asr');
assert.equal(at60.label, AUDIO_ASR_LABEL);
await assert.rejects(() => service.slice(id, '61/60'), /60-second boundary/);
await assert.rejects(() => service.plan('bad-id'), /Invalid radio Archive identifier/);
await assert.rejects(() => service.plan(noAsrId), /No public machine transcript/);

const disabled = createAudioAsrService({
  fetchImpl,
  getCandidates: () => store.getCandidateSnapshot(),
  getMetadata: (which) => store.getItemMetadata(which),
  enabled: () => false,
});
await assert.rejects(() => disabled.plan(id), /disabled/);

const app = express();
registerAudioAsrRoutes(app, service);
const listener = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => listener.once('listening', resolve));
const address = listener.address();
assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
try {
  const good = await fetch(`${base}/api/audio-asr/${id}/plan`);
  assert.equal(good.status, 200);
  assert.equal((await good.json() as any).source, 'asr');
  const bad = await fetch(`${base}/api/audio-asr/not-valid/plan`);
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get('content-type') ?? '', /application\/json/i);
  assert.equal((await bad.json() as any).error, 'invalid_identifier');
  const absent = await fetch(`${base}/api/audio-asr/${noAsrId}/plan`);
  assert.equal(absent.status, 404);
  assert.equal((await absent.json() as any).error, 'transcript_unavailable');
  const slice = await fetch(`${base}/api/audio-asr/${id}/slice?t=0%2F60`);
  assert.equal(slice.status, 200);
  assert.equal((await slice.json() as any).label, AUDIO_ASR_LABEL);
} finally {
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
}
console.log('audio ASR offline service, error paths, JSON route shape and relative-to-absolute math: all passed');
