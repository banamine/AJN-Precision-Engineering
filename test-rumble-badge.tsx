import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
const { isAjnLiveItem, RumbleLiveBadge } = await import('./src/components/RumbleLiveBadge');

const item = (o: Record<string, unknown>) => ({ src: 'https://x/a.mp3', mediaType: 'audio', title: 'X', ...o }) as never;
// AJN network audio shows the shortcut
assert.equal(isAjnLiveItem(item({ channelId: 'radio:ajn-alex-jones-show' })), true);
assert.equal(isAjnLiveItem(item({ channelId: 'radio:ajn-infowars-live-aac' })), true);
assert.equal(isAjnLiveItem(item({ channelId: 'ajn-radio', programId: 'ajn-radio' })), true);
assert.equal(isAjnLiveItem(item({ channelId: 'x', title: 'The Alex Jones Show - Hour 2' })), true);
// Everything else does not
assert.equal(isAjnLiveItem(item({ channelId: 'radio:ch109-warm-109', title: '109 Warm' })), false);
assert.equal(isAjnLiveItem(item({ channelId: 'podcast-bannon-war-room', title: "Bannon's War Room" })), false, 'AJN and Real America’s Voice stay apart');
assert.equal(isAjnLiveItem(null), false);

// Renders only with a navigate handler, and never claims the show is on air
const noop = () => {};
const on = renderToStaticMarkup(createElement(RumbleLiveBadge, { nowPlaying: item({ channelId: 'radio:ajn-alex-jones-show' }), onNavigate: noop }));
assert.match(on, /data-testid="rumble-live-badge"/);
assert.match(on, /ON RUMBLE/);
assert.ok(!/LIVE NOW|ON AIR/i.test(on), 'no on-air claim: the badge is a way in, not a status light');
assert.equal(renderToStaticMarkup(createElement(RumbleLiveBadge, { nowPlaying: item({ channelId: 'radio:ajn-alex-jones-show' }) })), '');
assert.equal(renderToStaticMarkup(createElement(RumbleLiveBadge, { nowPlaying: item({ channelId: 'radio:ch109-warm-109' }), onNavigate: noop })), '');

// The Rumble tab is reachable by hash, and that hash lands on the News view
const tabs = fs.readFileSync('src/components/NewsTabs.tsx', 'utf-8');
assert.match(tabs, /id: "rumble"[^}]*hash: "rumble"/);
assert.match(fs.readFileSync('src/App.tsx', 'utf-8'), /case 'rumble':\s*\n\s*case 'bannedvideo': return 'news';/);

// Podcast sources: Rush added with the feed's real title; War Room left on the feed that works
const src = JSON.parse(fs.readFileSync('src/data/podcastSources.json', 'utf-8'));
const rush = src.sources.find((s: any) => s.id === 'rush-limbaugh-wisdom');
assert.ok(rush && rush.enabled && rush.feedUrl.includes('omnycontent.com'), 'Rush syndicated feed present');
assert.ok(rush.name.includes('Golden EIB'), "name matches the feed's own title");
const war = src.sources.find((s: any) => s.id === 'bannon-war-room');
assert.equal(war.feedUrl, 'https://listen.warroom.org/feed.xml', 'War Room feed unchanged: the proposed replacement was a different podcast');
console.log('rumble badge + podcast sources: all checks passed');
