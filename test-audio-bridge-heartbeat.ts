import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audioPlaybackHeartbeatState } from './src/utils/audioBridgeHeartbeat.ts';

assert.deepEqual(audioPlaybackHeartbeatState({
  readyState: 0, networkState: 3, paused: true, error: null,
}), {
  playbackResult: 'not-ready',
  mediaReadyState: 0,
  mediaNetworkState: 3,
  mediaPaused: true,
  mediaErrorCode: null,
});

assert.deepEqual(audioPlaybackHeartbeatState({
  readyState: 4, networkState: 1, paused: false, error: null,
}), {
  playbackResult: 'playing',
  mediaReadyState: 4,
  mediaNetworkState: 1,
  mediaPaused: false,
  mediaErrorCode: null,
});

assert.deepEqual(audioPlaybackHeartbeatState({
  readyState: 0, networkState: 3, paused: true, error: { code: 4 },
}), {
  playbackResult: 'media-error',
  mediaReadyState: 0,
  mediaNetworkState: 3,
  mediaPaused: true,
  mediaErrorCode: 4,
});

const hookSource = readFileSync(new URL('./src/use-audio-normalization.ts', import.meta.url), 'utf8');
assert.match(hookSource, /AUDIO_BRIDGE_CONNECTED/);
assert.match(hookSource, /AUDIO_BRIDGE_MEDIA_ERROR/);
assert.match(hookSource, /audioPlaybackHeartbeatState\(media\)/);
assert.doesNotMatch(hookSource, /AUDIO_BRIDGE_OK/);

console.log('audio bridge heartbeat reports actual readiness/error state: PASS');
