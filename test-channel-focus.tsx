import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { getScheduleForGuide } from './guideRegistry';
import { PROGRAM_POOL } from './src/data/homeFeatures';
import { FOCUS_TTL_MS, clearChannelFocusForTests, peekChannelFocus, requestChannelFocus, takeChannelFocus } from './src/guide/focusRequest';
import { HomeView } from './src/components/HomeView';

// 1. Request lifecycle: held until taken, per guide, expires, newest wins.
clearChannelFocusForTests();
assert.equal(peekChannelFocus('classic-tv'), null);
requestChannelFocus('classic-tv', 'classic-ajn-archive-1', 1000);
assert.equal(peekChannelFocus('classic-tv', 1000 + 100)?.channelId, 'classic-ajn-archive-1');
assert.equal(peekChannelFocus('movies-classics-vault', 1100), null, 'another guide never sees it');
assert.equal(peekChannelFocus('classic-tv', 1100)?.channelId, 'classic-ajn-archive-1', 'peek does not consume');
assert.equal(takeChannelFocus('classic-tv', 1200)?.channelId, 'classic-ajn-archive-1');
assert.equal(takeChannelFocus('classic-tv', 1200), null, 'consumed once');
requestChannelFocus('classic-tv', 'a', 5000); requestChannelFocus('classic-tv', 'b', 5001);
assert.equal(takeChannelFocus('classic-tv', 5002)?.channelId, 'b', 'newest request wins');
requestChannelFocus('classic-tv', 'late', 0);
assert.equal(peekChannelFocus('classic-tv', FOCUS_TTL_MS + 1), null, 'expired request is dropped');
clearChannelFocusForTests();

// 2. The tile points at a channel that really exists in the real Classic TV schedule (guards id drift).
const tile = PROGRAM_POOL.find((t) => t.focusChannelId);
assert.ok(tile, 'a tile with focusChannelId exists');
assert.equal(tile!.guideId, 'classic-tv'); assert.equal(tile!.dest, 'tv-guide'); assert.equal(tile!.pinned, true);
const classic = await getScheduleForGuide('classic-tv', new Date('2026-10-14T12:00:00Z'));
const ch = classic.find((c) => c.id === tile!.focusChannelId);
assert.ok(ch, `channel ${tile!.focusChannelId} is in the Classic TV schedule`);
assert.equal(ch!.name, 'AJN archive 1');
assert.equal(PROGRAM_POOL.filter((t) => t.pinned).length, 1, 'one pinned tile leaves two rotating slots');
assert.equal(new Set(PROGRAM_POOL.map((t) => t.id)).size, PROGRAM_POOL.length, 'tile ids unique');

// 3. Home renders the pinned tile every day (rotation cannot drop it).
const html = renderToStaticMarkup(<HomeView onNavigate={() => {}} onPlayProgram={() => {}} nowPlaying={null} recentlyPlayed={[]} onResumeRecentlyPlayed={() => {}} />);
assert.match(html, /AJN archive 1/);
assert.match(html, /CLASSIC TV · CHANNEL/);
console.log('PASS channel-focus: request lifecycle, real channel id exists, pinned tile rendered');
