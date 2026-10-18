import assert from 'node:assert/strict';

// Run against the real prebuilt server; no dependencies, fixtures or POST calls.
// node test-music-schedule-budget.mjs http://127.0.0.1:24437
const base = process.argv[2] || 'http://127.0.0.1:3000';
const WIRE_LIMIT = 24 * 1024 * 1024;
const AUDIO_RAW_LIMIT = 24 * 1024 * 1024;
const CLASSIC_RAW_LIMIT = 32 * 1024 * 1024;
const AUDIO_ADVISORY = 8 * 1024 * 1024;
const results = [];
for (const guide of ['audio-podcasts', 'classic-tv']) {
  const response = await fetch(`${base}/api/schedule?guide=${guide}`);
  assert.equal(response.status, 200, `${guide} schedule HTTP status`);
  const body = Buffer.from(await response.arrayBuffer());
  const contentLength = response.headers.get('content-length');
  const wireBytes = contentLength === null ? body.length : Number(contentLength);
  assert.ok(Number.isFinite(wireBytes) && wireBytes >= 0, `${guide}: response has a valid wire Content-Length`);
  assert.ok(wireBytes <= WIRE_LIMIT,
    `${guide}: ${wireBytes} wire bytes exceeds 24 MiB (${WIRE_LIMIT})`);
  const rawBytes = body.length;
  const rawLimit = guide === 'classic-tv' ? CLASSIC_RAW_LIMIT : AUDIO_RAW_LIMIT;
  assert.ok(rawBytes <= rawLimit,
    `${guide}: ${rawBytes} decoded bytes exceeds its ${rawLimit} byte raw budget`);
  const data = JSON.parse(body.toString('utf8'));
  const music = data.channels.filter(channel => channel.id.startsWith('item-music-'));
  assert.equal(music.length, guide === 'audio-podcasts' ? 25 : 0);
  if (guide === 'audio-podcasts') {
    for (const channel of music) {
      assert.equal(channel.guideId, guide);
      assert.ok(channel.programs.every(program => program.guideId === guide));
    }
  }
  const xmlResponse = await fetch(`${base}/api/guides/${guide}/epg.xml`);
  assert.equal(xmlResponse.status, 200);
  const xml = await xmlResponse.text();
  const programmes = (xml.match(/<programme\b/g) || []).length;
  const programs = data.channels.reduce((count, channel) => count + channel.programs.length, 0);
  assert.equal(programmes, programs, `${guide}: XML must remain track-exact`);
  const result = { guide, wireBytes, rawBytes, wireLimitBytes: WIRE_LIMIT, rawLimitBytes: rawLimit,
    channels: data.channels.length, musicChannels: music.length, programs, xmlProgrammes: programmes };
  results.push(result);
  console.log(JSON.stringify(result));
  if (guide === 'audio-podcasts' && rawBytes > AUDIO_ADVISORY) {
    console.log('ADVISORY: Audio exceeds 8 MiB; propose slimming repeated metadata, do not implement it in Phase A.');
  }
}
console.log('schedule size/membership/track-exact XML budget: PASS');

// Prove the hard assertion itself rejects over-budget bodies.
assert.throws(() => assert.ok(WIRE_LIMIT + 1 <= WIRE_LIMIT));
assert.ok(results.every(result => result.wireBytes <= WIRE_LIMIT));
