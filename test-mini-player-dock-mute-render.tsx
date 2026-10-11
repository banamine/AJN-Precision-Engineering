import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MiniPlayerDock } from './src/components/MiniPlayerDock';
import type { NowPlayingMedia } from './src/types';

const mockNowPlaying: NowPlayingMedia = {
  id: 'test-1',
  src: 'https://example.com/audio.mp3',
  title: 'Test Audio Broadcast',
  subtitle: 'Channel 1',
  mediaType: 'audio',
  progressSeconds: 0,
  updatedAt: Date.now(),
};

const html = renderToStaticMarkup(
  <MiniPlayerDock
    nowPlaying={mockNowPlaying}
    onOpenFullPlayer={() => {}}
    onDismiss={() => {}}
  />
);

assert.ok(html.includes('id="mini-player-mute-btn"'), 'MiniPlayerDock must render mini-player-mute-btn');
assert.ok(html.includes('aria-label='), 'MiniPlayerDock mute button must have aria-label');
assert.ok(html.includes('data-testid="mute-button"'), 'MiniPlayerDock must have mute-button testid');

console.log('PASS: MiniPlayerDock mute button rendering verified');
