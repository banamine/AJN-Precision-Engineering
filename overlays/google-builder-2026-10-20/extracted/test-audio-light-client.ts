import assert from 'node:assert/strict';
import type { ScheduleChannel } from './src/types';
import { loadSchedule } from './src/guide/loadSchedule';
import { clearScheduleCache, getCachedLightSchedule, getCachedSchedule, isValidAudioLightSchedule, setCachedLightSchedule, shouldDisplayCachedSchedule } from './src/guide/scheduleCache';

const channel: ScheduleChannel = {
  id: 'item-music-client-fixture',
  guideId: 'audio-podcasts',
  name: 'DEMO client fixture',
  mediaType: 'audio',
  programs: [0, 1, 2].map((index) => ({
    id: `demo-program-${index}`,
    guideId: 'audio-podcasts',
    channelId: 'item-music-client-fixture',
    title: `DEMO synthetic program ${index + 1}`,
    startTime: index,
    endTime: index + 1,
    startHour: index,
    endHour: index + 1,
    mediaType: 'audio' as const,
    mediaUrl: `/synthetic/demo-${index}.mp3`,
  })),
  programCount: 30,
  programsComplete: false,
};

clearScheduleCache();
let audioUrl = '';
const audioFetch: typeof fetch = async (input) => {
  audioUrl = String(input);
  return new Response(JSON.stringify({ guideId: 'audio-podcasts', light: true, channels: [channel] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
await loadSchedule('audio-podcasts', audioFetch);
assert.match(audioUrl, /^\/api\/schedule\?guide=audio-podcasts&tz=-?\d+&light=1$/);
assert.equal(getCachedLightSchedule('audio-podcasts')?.channels[0].id, channel.id);
assert.equal(getCachedSchedule('audio-podcasts'), undefined, 'sparse response is not stored as a full schedule');
assert.equal(isValidAudioLightSchedule([channel]), true);
assert.equal(isValidAudioLightSchedule([{ ...channel, programs: channel.programs.slice(0, 2) }]), false, 'light rows require exactly three programs');

clearScheduleCache();
let classicUrl = '';
const classicFetch: typeof fetch = async (input) => {
  classicUrl = String(input);
  return new Response(JSON.stringify({ guideId: 'classic-tv', channels: [channel] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
await loadSchedule('classic-tv', classicFetch);
assert.match(classicUrl, /^\/api\/schedule\?guide=classic-tv&tz=-?\d+$/);
assert.doesNotMatch(classicUrl, /light=1/);

clearScheduleCache();
setCachedLightSchedule('audio-podcasts', [channel], 0);
const staleAudioCache = getCachedLightSchedule('audio-podcasts');
assert.equal(shouldDisplayCachedSchedule('audio-podcasts', staleAudioCache, 10 * 60 * 1000), false, 'Today does not present stale audio rows as current');
assert.equal(shouldDisplayCachedSchedule('classic-tv', staleAudioCache, 10 * 60 * 1000), true, 'Classic cache display policy remains unchanged');
let staleRefreshes = 0;
const staleAudioFetch: typeof fetch = async () => {
  staleRefreshes++;
  return new Response(JSON.stringify({ error: 'DEMO synthetic unavailable' }), { status: 503 });
};
await assert.rejects(() => loadSchedule('audio-podcasts', staleAudioFetch), /HTTP 503/, 'stale audio is not silently returned as current on refresh failure');
assert.equal(staleRefreshes, 1);
console.log('PASS audio-light-client: light cache separation, stale audio rejection, and unchanged Classic URL');
