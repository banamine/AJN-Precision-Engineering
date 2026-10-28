import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const chrome = readFileSync('./src/components/PlayerChrome.tsx', 'utf8');
// LIVE only for an endless duration; unknown duration must never read as LIVE.
assert.match(chrome, /const live = time\.d === Infinity;/);
assert.doesNotMatch(chrome, /const live = !Number\.isFinite/);
assert.match(chrome, /Loading…/);
const mp = readFileSync('./src/MinimalPlayer.tsx', 'utf8');
assert.match(mp, /data-testid="playback-retry"/);
assert.match(mp, /data-testid="playback-back-to-guide"/);
const pv = readFileSync('./src/components/PlayerView.tsx', 'utf8');
assert.match(pv, /data-testid="player-open-guide"/);
assert.doesNotMatch(pv, />No media selected\.</);
const guide = readFileSync('./src/components/TvGuideView.tsx', 'utf8');
assert.doesNotMatch(guide, /Live Grid Active/);
const epg = readFileSync('./src/EpgGuide.tsx', 'utf8');
assert.match(epg, /replay-tag/); assert.match(epg, /On Air Now/); // existing tests look for "On Air Now"
console.log('player honesty: all passed');
