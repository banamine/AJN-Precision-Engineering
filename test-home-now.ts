import assert from 'node:assert/strict';
import { pickOnNow, archiveCoverFor, hashString } from './server/homeNow';

const T = Date.parse('2026-10-11T18:30:00Z');
const prog = (channelId: string, startIso: string, endIso: string, extra: any = {}) => ({
  id: `p-${channelId}`, guideId: 'g', channelId, title: `Show ${channelId}`, startTime: 0, endTime: 1,
  startTimeUtc: startIso, endTimeUtc: endIso, mediaType: 'video' as const, mediaUrl: '', archivePath: `/download/item_${channelId}/file.mp4`, ...extra,
});
const ch = (id: string, programs: any[], extra: any = {}) => ({ id, guideId: 'g', name: `Chan ${id}`, mediaType: 'video' as const, programs, ...extra });

// only programs airing at T count; ended and future ones do not
const channels: any[] = [
  ch('a', [prog('a', '2026-10-11T17:00:00Z', '2026-10-11T18:00:00Z'), prog('a', '2026-10-11T18:00:00Z', '2026-10-11T19:00:00Z')]),
  ch('b', [prog('b', '2026-10-11T19:00:00Z', '2026-10-11T20:00:00Z')]),
  ch('c', [prog('c', '2026-10-11T18:00:00Z', '2026-10-11T19:00:00Z')], { sourceStatus: 'restricted' }),
  ch('d', [prog('d', '2026-10-11T18:00:00Z', '2026-10-11T19:00:00Z', { archivePath: '', mediaUrl: '' })]),
];
const one = pickOnNow('g', 'Guide G', channels, T)!;
assert.equal(one.channelId, 'a');
assert.equal(one.title, 'Show a');
assert.equal(one.startTimeUtc, '2026-10-11T18:00:00Z');
assert.equal(one.thumb, '/api/archive/proxy?path=' + encodeURIComponent('/download/item_a/__ia_thumb.jpg'));
// end is exclusive, start is inclusive
assert.equal(pickOnNow('g', 'G', channels, Date.parse('2026-10-11T19:00:00Z'))!.channelId, 'b'); // a ended at 19:00, b starts at 19:00
assert.equal(pickOnNow('g', 'G', channels, Date.parse('2026-10-11T20:00:00Z')), null);
assert.equal(pickOnNow('g', 'G', channels, Date.parse('2026-10-11T18:00:00Z'))!.channelId, 'a');
// nothing airing, empty, or bad dates: null, never a made-up item
assert.equal(pickOnNow('g', 'G', [], T), null);
assert.equal(pickOnNow('g', 'G', [ch('x', [prog('x', 'bad', 'worse')])] as any, T), null);
// audio keeps its type; non-archive path falls back to the channel logo
const aud = pickOnNow('g', 'G', [ch('r', [prog('r', '2026-10-11T18:00:00Z', '2026-10-11T19:00:00Z', { archivePath: undefined, mediaUrl: 'https://x/live.mp3' })], { mediaType: 'audio', logo: '/logos/r.png' })] as any, T)!;
assert.equal(aud.mediaType, 'audio'); assert.equal(aud.archivePath, 'https://x/live.mp3'); assert.equal(aud.thumb, '/logos/r.png');
// deterministic within the hour, and spreads across channels over hours
const many: any[] = Array.from({ length: 12 }, (_, i) => ch(`c${i}`, [prog(`c${i}`, '2026-10-11T00:00:00Z', '2026-10-12T00:00:00Z')]));
const a1 = pickOnNow('g', 'G', many, T)!.channelId, a2 = pickOnNow('g', 'G', many, T + 600_000)!.channelId;
assert.equal(a1, a2);
const seen = new Set<string>();
for (let h = 0; h < 12; h++) seen.add(pickOnNow('g', 'G', many, Date.parse('2026-10-11T00:30:00Z') + h * 3_600_000)!.channelId);
assert.ok(seen.size >= 4, `expected the pick to vary by hour, saw ${seen.size}`);
assert.equal(hashString('x'), hashString('x'));
assert.equal(archiveCoverFor('https://x/y.mp3'), undefined);
console.log('test-home-now: all passed');
