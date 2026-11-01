import assert from 'node:assert/strict';
import { pickAnotherItem, nextInLoop, fullShowTargets, radioNext, programTarget, targetKey } from './src/utils/continuity.ts';
import { pickNext } from './src/components/PlayerView.tsx';

const P = (id: string, extra: any = {}) => ({ id, title: `T ${id}`, mediaType: 'video', archivePath: `/download/${id}/${id}.mp4`, mediaUrl: `/api/archive/proxy?path=${id}`, ...extra });
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

// programTarget: needs a media reference
assert.equal(programTarget({ id: 'x', title: 'no media' }), null);
assert.equal(programTarget(P('a'), 'g', 'c')!.channelId, 'c');

// pickAnotherItem: prefers the program on air now, never the current item, never a failed one
const sched = [{ guideId: 'g1', channels: [{ id: 'c1', programs: [
  P('old', { startTimeUtc: '2026-10-11T08:00:00Z', endTimeUtc: '2026-10-11T09:00:00Z' }),
  P('cur', { startTimeUtc: '2026-10-11T11:00:00Z', endTimeUtc: '2026-10-11T13:00:00Z' }),
  P('live', { startTimeUtc: '2026-10-11T11:30:00Z', endTimeUtc: '2026-10-11T12:30:00Z' }),
] }] }];
assert.equal(pickAnotherItem(sched, { programId: 'cur', archivePath: '/download/cur/cur.mp4' }, new Set(), NOW)!.programId, 'live');
assert.equal(pickAnotherItem(sched, { programId: 'cur', archivePath: '/download/cur/cur.mp4' }, new Set(['live']), NOW)!.programId, 'old', 'failed items are skipped; falls back to any playable item');
assert.equal(pickAnotherItem([{ guideId: 'g', channels: [{ id: 'c', programs: [P('only')] }] }], { programId: 'only' }, new Set(), NOW), null, 'only the current item exists -> nothing else');
assert.equal(pickAnotherItem([], {}, new Set(), NOW), null);
assert.equal(pickAnotherItem([{ guideId: 'g', channels: [{ id: 'c', programs: [{ id: 'n', title: 'no media' }] }] }], {}, new Set(), NOW), null, 'items without media are never picked');

// nextInLoop: wraps, one item loops onto itself, skips failed, null only when all failed
const L = [{ src: 'a', programId: 'a' }, { src: 'b', programId: 'b' }, { src: 'c', programId: 'c' }];
assert.equal(nextInLoop(L, 'a', new Set())!.src, 'b');
assert.equal(nextInLoop(L, 'c', new Set())!.src, 'a', 'wraps');
assert.equal(nextInLoop(L, 'a', new Set(['b']))!.src, 'c');
assert.equal(nextInLoop(L, 'zzz', new Set())!.src, 'a', 'unknown current starts at the first');
assert.equal(nextInLoop([L[0]], 'a', new Set())!.src, 'a', 'single item loops');
assert.equal(nextInLoop(L, 'a', new Set(['a', 'b', 'c'])), null);
assert.equal(nextInLoop([], 'a', new Set()), null);

// fullShowTargets: audio, ajn-radio, ignores items without a url
const shows: any[] = [{ showSlug: 'alex-jones', showName: 'Alex Jones', id: 'i1', url: 'https://x/20261002_Fri_Alex.mp3', title: 'Alex Jones', airDate: '2026-10-02', dayKind: 'weekday', dateLabel: 'Oct 2', kindLabel: 'REGULAR SHOW' }, { id: 'i2', url: '' }];
const ft = fullShowTargets(shows); assert.equal(ft.length, 1); assert.equal(ft[0].mediaType, 'audio'); assert.equal(ft[0].channelId, 'ajn-radio');

// radioNext: next entry, wraps, audio unless video wanted and present, handles ":video" ids
const E = (id: string, video: string | null = null): any => ({ id, title: id, audioUrl: `https://x/${id}.mp3`, videoUrl: video });
const R = [E('r1', 'https://x/r1.m4v'), E('r2'), E('r3', 'https://x/r3.m4v')];
assert.equal(radioNext(R, 'r1', false, new Set())!.programId, 'r2');
assert.equal(radioNext(R, 'r3', false, new Set())!.programId, 'r1', 'wraps');
assert.equal(radioNext(R, 'r2', true, new Set())!.src, 'https://x/r3.m4v');
assert.equal(radioNext(R, 'r1:video', true, new Set())!.programId, 'r2', 'video wanted but r2 has none -> its audio');
assert.equal(radioNext(R, 'r1', false, new Set(['r2']))!.programId, 'r3');
assert.equal(radioNext([], 'r1', false, new Set()), null);
assert.equal(targetKey({ programId: 'p', src: 's' }), 'p');

// pickNext (tier 1, unchanged rule): next program, wraps to the first
const progs = [P('a'), P('b')];
assert.equal((pickNext({ programId: 'a', src: '/api/archive/proxy?path=a' }, progs) as any).next.id, 'b');
assert.equal((pickNext({ programId: 'b', src: '/api/archive/proxy?path=b' }, progs) as any).nextIndex, 0, 'wraps to the first');
console.log('continuity: all passed');
