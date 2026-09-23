// Offline regression for the AJN Audio source contract (mocked index HTML).
import assert from 'node:assert/strict';
import { ajnAudioContract, airDateFromFilename } from './server/sources/ajnAudio.ts';

const now = new Date('2026-09-23T12:00:00Z');
const ctx = { now, signal: new AbortController().signal };
const page = (token: string) => `<html><body>
<a href="https://cdn.ajn.test/hourly/Alex_Jones_Show_2026-09-22_hr2.mp3?token=${token}">hr2</a>
<a href="https://cdn.ajn.test/hourly/Alex_Jones_Show_2026-09-22_hr2.mp3?token=${token}">dup</a>
<a href="https://cdn.ajn.test/hourly/Special%20Report.mp3?token=${token}">special</a>
<a href="http://insecure.ajn.test/hourly/old.mp3">old</a>
</body></html>`;
const fetchWith = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;

assert.equal(airDateFromFilename('Alex_Jones_Show_2026-09-22_hr2.mp3')?.toISOString(), '2026-09-22T02:00:00.000Z');
assert.equal(airDateFromFilename('20260922-segment.mp3')?.toISOString(), '2026-09-22T00:00:00.000Z');
assert.equal(airDateFromFilename('Special Report.mp3'), null);

const a = await ajnAudioContract.hook({ kind: 'hourly', fetchImpl: fetchWith(200, page('alpha')) }, ctx);
assert.equal(a.status, 'partial');
assert.equal(a.programs.length, 2, 'duplicate hrefs collapse to one item');
assert.deepEqual(a.rejected.map((r) => r.reason), ['audio URL is not HTTPS']);
const hr2 = a.programs.find((p) => p.title.includes('2026'))!;
assert.equal(hr2.startTimeUtc, '2026-09-22T02:00:00.000Z');
assert.equal(hr2.metadata?.airDateSource, 'filename');
const special = a.programs.find((p) => !p.startTimeUtc)!;
assert.equal(special.metadata?.airDateSource, 'unknown', 'no date is unknown, never "now"');
assert.equal(special.startTimeUtc, undefined);
assert.ok(!special.title.includes('token'), 'title must not carry the CDN token');

// Token rotation: same programs, same ids, new playable URL.
const b = await ajnAudioContract.hook({ kind: 'hourly', fetchImpl: fetchWith(200, page('beta')) }, ctx);
assert.deepEqual(b.programs.map((p) => p.id).sort(), a.programs.map((p) => p.id).sort());
assert.deepEqual(b.programs.map((p) => p.assetId).sort(), a.programs.map((p) => p.assetId).sort());
assert.ok(b.programs.every((p) => p.mediaUrl.includes('token=beta')), 'playback uses the fresh token');

const r403 = await ajnAudioContract.hook({ kind: 'segment', fetchImpl: fetchWith(403) }, ctx);
assert.equal(r403.status, 'restricted');
const r500 = await ajnAudioContract.hook({ kind: 'segment', fetchImpl: fetchWith(500) }, ctx);
assert.equal(r500.status, 'upstream_error');
console.log('ajn audio contract regression: all passed');
