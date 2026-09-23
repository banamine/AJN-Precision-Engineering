// Regression: Science Documentaries exposes the NOVA canonical programs.
import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry.ts';
const channels = await getScheduleForGuide('science-documentaries');
assert.equal(channels.length, 1);
assert.equal(channels[0].id, 'nova-wonders');
assert.equal(channels[0].programs.length, 6);
assert.ok(channels[0].programs.every((p) => p.mediaUrl?.startsWith('/api/archive/proxy?path=')));
console.log('science documentaries guide regression: all passed');
