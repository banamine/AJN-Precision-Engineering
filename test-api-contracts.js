import assert from 'node:assert/strict';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';

async function getJson(path) {
  const response = await fetch(baseUrl + path);
  const text = await response.text();
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

await getJson('/api/health');

const channels = await getJson('/api/channels');
assert.ok(Array.isArray(channels.channels), '/api/channels.channels must be an array');
for (const channel of channels.channels.slice(0, 25)) {
  assert.equal(typeof channel.id, 'string');
  assert.equal(typeof channel.name, 'string');
  assert.ok(Array.isArray(channel.sources));
  for (const source of channel.sources) {
    assert.equal(typeof source.id, 'string');
    assert.equal(typeof source.url, 'string');
    assert.ok(source.url.length > 0);
  }
}

const schedule = await getJson('/api/schedule?guide=cable-tv');
assert.ok(Array.isArray(schedule.channels), '/api/schedule.channels must be an array');
for (const channel of schedule.channels.slice(0, 25)) {
  assert.ok(Array.isArray(channel.programs));
  for (const program of channel.programs) {
    assert.equal(typeof program.id, 'string');
    assert.equal(typeof program.title, 'string');
    assert.ok(program.id.length > 0);
  }
}

console.log('API contract regression: PASS');
