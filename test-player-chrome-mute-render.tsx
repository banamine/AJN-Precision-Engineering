import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerChrome } from './src/components/PlayerChrome';

const dummyRef = { current: null };

// 1. Render Video player while muted
const videoMutedHtml = renderToStaticMarkup(
  <PlayerChrome
    mediaRef={dummyRef}
    containerRef={dummyRef}
    sourceKey="video:test"
    isVideo={true}
    isPlaying={true}
    isMuted={true}
    volume={1}
    isFullscreen={false}
    statusText="Playing"
    onTogglePlay={() => {}}
    onToggleMute={() => {}}
    onVolume={() => {}}
    onToggleFullscreen={() => {}}
    visualizerOn={false}
    onToggleVisualizer={() => {}}
    analyzerState="active"
    diagnosticsOpen={false}
    onToggleDiagnostics={() => {}}
  />
);

assert.ok(videoMutedHtml.includes('mute-indicator-ring'), 'Video view while muted must have mute-indicator-ring');
assert.ok(videoMutedHtml.includes('aria-label="Muted — click to unmute"'), 'Video view while muted must be labeled Muted');
assert.ok(videoMutedHtml.includes('<span class="sr-only">Muted</span>'), 'Video view while muted must have sr-only Muted text');
assert.ok(videoMutedHtml.includes('data-muted="true"'), 'Video view while muted must have data-muted="true"');

// 2. Render Video player while unmuted
const videoUnmutedHtml = renderToStaticMarkup(
  <PlayerChrome
    mediaRef={dummyRef}
    containerRef={dummyRef}
    sourceKey="video:test"
    isVideo={true}
    isPlaying={true}
    isMuted={false}
    volume={1}
    isFullscreen={false}
    statusText="Playing"
    onTogglePlay={() => {}}
    onToggleMute={() => {}}
    onVolume={() => {}}
    onToggleFullscreen={() => {}}
    visualizerOn={false}
    onToggleVisualizer={() => {}}
    analyzerState="active"
    diagnosticsOpen={false}
    onToggleDiagnostics={() => {}}
  />
);

assert.ok(!videoUnmutedHtml.includes('mute-indicator-ring'), 'Video view while unmuted must NOT have mute-indicator-ring');
assert.ok(videoUnmutedHtml.includes('aria-label="Unmuted — click to mute"'), 'Video view while unmuted must be labeled Unmuted');
assert.ok(videoUnmutedHtml.includes('<span class="sr-only">Unmuted</span>'), 'Video view while unmuted must have sr-only Unmuted text');
assert.ok(videoUnmutedHtml.includes('data-muted="false"'), 'Video view while unmuted must have data-muted="false"');

// 3. Render Audio player while muted
const audioMutedHtml = renderToStaticMarkup(
  <PlayerChrome
    mediaRef={dummyRef}
    containerRef={dummyRef}
    sourceKey="audio:test"
    isVideo={false}
    isPlaying={true}
    isMuted={true}
    volume={1}
    isFullscreen={false}
    statusText="Playing"
    onTogglePlay={() => {}}
    onToggleMute={() => {}}
    onVolume={() => {}}
    onToggleFullscreen={() => {}}
    visualizerOn={false}
    onToggleVisualizer={() => {}}
    analyzerState="active"
    diagnosticsOpen={false}
    onToggleDiagnostics={() => {}}
  />
);

assert.ok(audioMutedHtml.includes('mute-indicator-ring'), 'Audio view while muted must have mute-indicator-ring');
assert.ok(audioMutedHtml.includes('aria-label="Muted — click to unmute"'), 'Audio view while muted must be labeled Muted');
assert.ok(audioMutedHtml.includes('<span class="sr-only">Muted</span>'), 'Audio view while muted must have sr-only Muted text');
assert.ok(audioMutedHtml.includes('data-muted="true"'), 'Audio view while muted must have data-muted="true"');

// 4. Render Audio player while unmuted
const audioUnmutedHtml = renderToStaticMarkup(
  <PlayerChrome
    mediaRef={dummyRef}
    containerRef={dummyRef}
    sourceKey="audio:test"
    isVideo={false}
    isPlaying={true}
    isMuted={false}
    volume={1}
    isFullscreen={false}
    statusText="Playing"
    onTogglePlay={() => {}}
    onToggleMute={() => {}}
    onVolume={() => {}}
    onToggleFullscreen={() => {}}
    visualizerOn={false}
    onToggleVisualizer={() => {}}
    analyzerState="active"
    diagnosticsOpen={false}
    onToggleDiagnostics={() => {}}
  />
);

assert.ok(!audioUnmutedHtml.includes('mute-indicator-ring'), 'Audio view while unmuted must NOT have mute-indicator-ring');
assert.ok(audioUnmutedHtml.includes('aria-label="Unmuted — click to mute"'), 'Audio view while unmuted must be labeled Unmuted');
assert.ok(audioUnmutedHtml.includes('<span class="sr-only">Unmuted</span>'), 'Audio view while unmuted must have sr-only Unmuted text');
assert.ok(audioUnmutedHtml.includes('data-muted="false"'), 'Audio view while unmuted must have data-muted="false"');

console.log('PASS: PlayerChrome markup rendering verified for all audio and video playback views');
