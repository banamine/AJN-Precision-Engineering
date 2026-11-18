import assert from 'node:assert/strict';
import { episodeNote } from './server/episodeNote';
import { toPrograms, buildState, type PodcastSource } from './server/podcasts';
const src: PodcastSource = { id: 'demo', name: 'Demo Show', feedUrl: 'https://x.test/f', expectTitle: 'Demo', enabled: true };
const item = (g: string, d: string) => `<item><guid>${g}</guid><title>Ep ${g}</title><description>${d}</description><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><enclosure url="https://x.test/${g}.mp3" type="audio/mpeg"/></item>`;
const st = buildState(src, { head: '<title>Demo</title>', items: [item('a', 'Hello world notes'), item('b', 'Listen in the archive')] }, new Date('2026-11-18T00:00:00Z'));
const progs = toPrograms(st, 'audio-podcasts');
const a = progs.find((p) => p.title === 'Ep a')!, b = progs.find((p) => p.title === 'Ep b')!;
assert.match(episodeNote(a.id, [st]) ?? '', /Hello world notes/);
assert.equal(episodeNote(b.id, [st]), null);            // never shows the word archive
assert.equal(episodeNote('pod-demo-ia-1234', [st]), null);
assert.equal(episodeNote('../etc/passwd', [st]), null);
assert.equal(episodeNote(undefined, [st]), null);
assert.equal(episodeNote('pod-other-abc', [st]), null);
console.log('episode note tests passed');
