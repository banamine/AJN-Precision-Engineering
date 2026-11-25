import assert from 'node:assert/strict';

// Run against the real prebuilt server; no dependencies, fixtures or POST calls.
// node test-music-schedule-budget.mjs http://127.0.0.1:24437
const base = process.argv[2] || 'http://127.0.0.1:3000';
const HARD_LIMIT = 24 * 1024 * 1024;
const AUDIO_ADVISORY = 8 * 1024 * 1024;
const results = [];
for (const guide of ['audio-podcasts', 'classic-tv']) {
  const response = await fetch(`${base}/api/schedule?guide=${guide}`);
  assert.equal(response.status, 200, `${guide} schedule HTTP status`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length <= HARD_LIMIT,
    `${guide}: ${bytes.length} bytes exceeds 24 MiB (${HARD_LIMIT})`);
  const data = JSON.parse(bytes.toString('utf8'));
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
  const result = { guide, bytes: bytes.length, limitBytes: HARD_LIMIT,
    channels: data.channels.length, musicChannels: music.length, programs, xmlProgrammes: programmes };
  results.push(result);
  console.log(JSON.stringify(result));
  if (guide === 'audio-podcasts' && bytes.length > AUDIO_ADVISORY) {
    console.log('ADVISORY: Audio exceeds 8 MiB; propose slimming repeated metadata, do not implement it in Phase A.');
  }
}
console.log('schedule size/membership/track-exact XML budget: PASS');

// Prove the hard assertion itself rejects over-budget bodies.
assert.throws(() => assert.ok(HARD_LIMIT + 1 <= HARD_LIMIT));
assert.ok(results.every(result => result.bytes <= HARD_LIMIT));
