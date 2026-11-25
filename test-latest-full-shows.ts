import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pickLatestFullShows } from './src/utils/latestFullShows';
import { HomeView } from './src/components/HomeView';

const H = 'https://archive.alexjoneslive.com/rss';
const it = (id: string, file: string, mediaType = 'audio', title = '') => ({ id, url: `${H}/${file}`, mediaType, title });
const alex = [it('a1', '20261008_Thu_Alex.mp3'), it('a2', '20261009_Fri_Alex.mp3'), it('a3', '20261003_Sat_Alex-Special.mp3'),
  it('hr', '20261009_Fri_Alex-Hr1.mp3'), it('vid', '20261010_Sat_Alex.m4v', 'video'), it('bad', '20261399_Fri_Alex.mp3')];
const war = [it('w1', '20261009_Fri_WarRoom.mp3'), it('w0', '20261002_Fri_WarRoom.mp3')];
let r = pickLatestFullShows({ Alex: alex, WarRoom: war });
assert.deepEqual(r.map((s) => [s.showSlug, s.id, s.airDate]), [['alex-jones', 'a2', '2026-10-09'], ['war-room', 'w1', '2026-10-09']]); // newest whole show; hours/video/bad dates ignored
assert.equal(r[0].dayKind, 'weekday');
// when the feed rolls to a new day the buttons follow, with no code change
r = pickLatestFullShows({ Alex: [...alex, it('a4', '20261010_Sat_Alex-Special.mp3')], WarRoom: [...war, it('w2', '20261012_Mon_WarRoom.mp3')] });
assert.equal(r[0].id, 'a4'); assert.equal(r[0].dayKind, 'special'); assert.match(r[0].kindLabel, /SPECIAL/);
assert.equal(r[1].id, 'w2');
// a show with nothing usable is absent, never invented
assert.deepEqual(pickLatestFullShows({ Alex: [], WarRoom: war }).map((s) => s.showSlug), ['war-room']);
assert.deepEqual(pickLatestFullShows({}), []);
// Home still renders (shortcuts load client-side, nothing breaks on first paint)
const html = renderToStaticMarkup(createElement(HomeView, { onNavigate() {}, onPlayProgram() {}, nowPlaying: null, recentlyPlayed: [], onResumeRecentlyPlayed() {} } as any));
assert.match(html, /PLAY FULL SHOW/); assert.match(html, /DRIVE PLAY/);
console.log('latest full shows: all passed');
