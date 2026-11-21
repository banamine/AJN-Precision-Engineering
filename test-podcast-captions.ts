import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseTranscript, pickTranscriptLink, transcriptPauses } from './src/utils/transcriptParse.ts';
import * as C from './src/utils/captionSync.ts';
import { estimatePods } from './src/utils/podcastAdSkip.ts';
import { setLock, locksOf, lockSourceOf, clearLocks } from './src/utils/captionLocks.ts';

/* ---- parser ---- */
const srt = '1\n00:00:01,000 --> 00:00:03,500\nSpeaker 1: Welcome &amp; hello.\n\n2\n00:00:05,000 --> 00:00:07,000\nSpeaker 2: <i>Thanks</i> for having me.\n\n3\n00:01:00,250 --> 00:01:02,000\nNo label here.\n';
let p = parseTranscript(srt);
assert.equal(p.cues.length, 3); assert.equal(p.hasSpeakers, true);
assert.deepEqual(p.cues[0], { s: 1, e: 3.5, t: 'Welcome & hello.', sp: 'Speaker 1' });
assert.equal(p.cues[1].t, 'Thanks for having me.'); assert.equal(p.cues[2].sp, undefined); assert.equal(p.cues[2].s, 60.25);
const vtt = 'WEBVTT\n\nNOTE x\n\n00:00:01.000 --> 00:00:02.000\nHi there\n\n01:00:00.500 --> 01:00:01.000 align:start\nOne hour in\n';
p = parseTranscript(vtt); assert.equal(p.cues.length, 2); assert.equal(p.cues[1].s, 3600.5); assert.equal(p.hasSpeakers, false);
assert.equal(parseTranscript('not a transcript').cues.length, 0, 'unreadable text gives no cues, never invented ones');
assert.equal(parseTranscript('1\n00:00:05,000 --> 00:00:01,000\nbackwards\n').cues.length, 0);
assert.equal(parseTranscript('1\n00:00:01,000 --> 00:00:02,000\nTime: 5 o\'clock sharp\n').cues[0].sp, undefined, 'a lowercase word before a colon is not a speaker');

/* ---- feed link: SRT first, VTT second, https only ---- */
const item = '<podcast:transcript url="https://a.example/t.vtt" type="text/vtt"/><podcast:transcript url="https://a.example/t.srt?x=1&amp;y=2" type="application/x-subrip" /><podcast:transcript url="https://a.example/t.html" type="text/html"/>';
assert.equal(pickTranscriptLink(item), 'https://a.example/t.srt?x=1&y=2');
assert.equal(pickTranscriptLink('<podcast:transcript url="https://a.example/t.vtt" type="text/vtt"/>'), 'https://a.example/t.vtt');
assert.equal(pickTranscriptLink('<podcast:transcript url="http://a.example/t.srt" type="application/srt"/>'), undefined, 'http is refused');
assert.equal(pickTranscriptLink('<podcast:transcript url="https://a.example/t.json" type="application/json"/>'), undefined, 'formats we do not read are skipped');

/* ---- pauses ---- */
const cues = [{ s: 0, e: 2, t: 'a' }, { s: 3, e: 5, t: 'b' }, { s: 5.2, e: 6, t: 'c' }];
assert.deepEqual(transcriptPauses(cues), [2.5], 'only the 1.0 s gap counts at the default 0.8 s; 0.2 s is not a pause');

/* ---- timeline: 2 breaks, offsets, locate, jump ---- */
const pods = [{ kind: 'pre' as const, ads: 5, cleanAt: 0 }, { kind: 'mid' as const, ads: 5, cleanAt: 400 }];
const est = estimatePods(pods, 300, 1000);            // 152 + 148 (the rest goes on the last break)
const tl = C.buildTimeline(est, 1000); let o = C.offsetsOf(tl, new Map());
assert.deepEqual(o.map(Math.round), [0, 152, 300]);
assert.deepEqual(C.locate(10, tl, o), { kind: 'ad', pod: 0, into: 10, length: 152 }.valueOf() && C.locate(10, tl, o));
assert.equal(C.locate(10, tl, o).kind, 'ad');
let w = C.locate(200, tl, o); assert.ok(w.kind === 'show' && Math.abs(w.show - 48) < 0.01 && w.seg === 1);
w = C.locate(560, tl, o); assert.equal(w.kind, 'ad', 'file 560 = clean 400 + 152 offset: the mid break starts here');
w = C.locate(710, tl, o); assert.ok(w.kind === 'show' && w.seg === 2 && Math.abs(w.show - 410) < 0.01);
assert.equal(Math.round(C.showToFile(48, tl, o)), 200); assert.equal(Math.round(C.showToFile(410, tl, o)), 710);
const noAds = C.buildTimeline([], 1000); const no = C.offsetsOf(noAds, new Map());
assert.deepEqual(C.locate(123, noAds, no), { kind: 'show', show: 123, seg: 0 });
/* a lock replaces one offset and everything after follows from it */
const lk = new Map([[1, 160]]); o = C.offsetsOf(tl, lk);
assert.deepEqual(o.map(Math.round), [0, 160, 308]);
w = C.locate(208, tl, o); assert.ok(w.kind === 'show' && Math.abs(w.show - 48) < 0.01, 'same file second, shifted by the measured offset');
const fixed = C.applyLocks(est, lk, 1000);
assert.equal(Math.round(fixed[1].startServed), 560); assert.equal(fixed[1].exact, false, 'start measured, end still estimated');
assert.equal(fixed[1].startExact, true);
const both = C.applyLocks(est, new Map([[1, 160], [2, 310]]), 1000);
assert.equal(both[1].exact, true); assert.equal(Math.round(both[1].length), 150);
assert.equal(C.applyLocks(est, new Map(), 1000)[1].startServed, est[1].startServed, 'no locks = estimates untouched');

/* ---- locks module ---- */
clearLocks('e1'); assert.equal(locksOf('e1').size, 0);
setLock('e1', 1, 151.6, 'auto'); setLock('e1', 2, 300, 'manual');
assert.equal(lockSourceOf('e1', 1), 'auto'); assert.equal(lockSourceOf('e1', 2), 'manual'); assert.equal(lockSourceOf('e1', 3), null);

/* ---- cue lookup ---- */
const cs = [{ s: 0, e: 1, t: 'a' }, { s: 5, e: 6, t: 'b' }, { s: 9, e: 10, t: 'c' }];
assert.equal(C.cueIndexAt(cs, -1), -1); assert.equal(C.cueIndexAt(cs, 0), 0); assert.equal(C.cueIndexAt(cs, 7), 1, 'a pause keeps the previous line'); assert.equal(C.cueIndexAt(cs, 99), 2);

/* ---- silence tracker ---- */
const st = new C.SilenceTracker();
for (let t = 10; t < 11; t += 0.1) st.feed(-20, t);
for (let t = 11; t < 11.8; t += 0.1) st.feed(-60, t);   // 0.8 s quiet
for (let t = 11.8; t < 12.5; t += 0.1) st.feed(-20, t);
assert.equal(st.list.length, 1); assert.ok(Math.abs(st.list[0].mid - 11.4) < 0.15, 'midpoint of the quiet stretch'); assert.equal(Math.round(st.since!), 10);
for (let t = 13; t < 13.3; t += 0.1) st.feed(-60, t); st.feed(-20, 13.3);
assert.equal(st.list.length, 1, 'a 0.3 s dip is a breath, not a pause');
st.feed(-20, 400); assert.equal(st.list.length, 0, 'a jump in file time (a seek) forgets the old readings'); assert.equal(st.since, 400);
for (let t = 401; t < 407; t += 0.1) st.feed(-60, t); st.feed(-20, 407);
assert.equal(st.list.length, 0, 'six seconds of nothing is a dropout, not a speech pause');

/* ---- lock-on, synthetic: speech with pauses, plus decoy silences ---- */
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let acc = 10; const showPauses = Array.from({ length: 45 }, () => (acc += 5 + rnd() * 14)); // irregular, like speech
const OFF = 152.4;
const heard = showPauses.map((q) => q + OFF + (((q * 7) % 1) - 0.5) * 0.3);                    // each real pause heard, a little jitter
const decoys = Array.from({ length: 40 }, () => 160 + rnd() * 300);                     // breaths and ads: unrelated silences
const sil = [...heard, ...decoys].sort((a, b) => a - b).filter((x) => x < 160 + 300);
const r = C.lockOn(sil, showPauses, 152, 90, { from: 160, to: 460 }, { from: 0, to: 480 });
assert.ok(r && Math.abs(r.offset - OFF) < 0.6, `locked at ${r?.offset}`);
assert.equal(C.lockOn(sil, showPauses, 152, 90, { from: 160, to: 260 }, { from: 0, to: 480 }), null, 'under 150 s heard: no lock');
const noise = Array.from({ length: 60 }, () => 160 + rnd() * 300);   // silences that do not follow the transcript
assert.equal(C.lockOn(noise, showPauses, 152, 90, { from: 160, to: 460 }, { from: 0, to: 480 }), null, 'unrelated silences must not produce a lock');
assert.equal(C.lockOn(sil, showPauses.slice(0, 3), 152, 90, { from: 160, to: 460 }, { from: 0, to: 480 }), null, 'too few pauses to be sure');

/* ---- lock-on, real Kuhner audio (only where the scratch data exists) ---- */
if (existsSync('/tmp/kp2/tr0.srt') && existsSync('/tmp/kp2/silr0.json')) {
  const mids = [454.0, 393.8, 346.9, 402.7, 684.0]; let ok = 0; let wrong = 0;
  for (let n = 0; n < 5; n++) {
    const pz = transcriptPauses(parseTranscript(readFileSync(`/tmp/kp2/tr${n}.srt`, 'utf8')).cues);
    const sl = (JSON.parse(readFileSync(`/tmp/kp2/silr${n}.json`, 'utf8')) as number[][]).filter(([a, b]) => b - a >= 0.6).map(([a, b]) => (a + b) / 2);
    const start = 166.3; const end = mids[n] + 151.3;
    for (let now = start + 150; now <= end; now += 10) {
      const res = C.lockOn(sl.filter((x) => x >= start && x <= now), pz, 152, 90, { from: start, to: now }, { from: 0, to: mids[n] });
      if (res) { if (Math.abs(res.offset - 151.3) < 4) ok++; else wrong++; break; }
    }
  }
  assert.equal(wrong, 0, 'never a wrong lock on real audio'); assert.ok(ok >= 3, `locked on ${ok} of 5 real episodes`);
  console.log(`real Kuhner audio: locked ${ok}/5, wrong ${wrong}`);
}

/* ---- sponsor reads: clustered clues only ---- */
const body = (t: string, s: number) => ({ s, e: s + 5, t });
const read = [body('This episode is brought to you by Acme Mattress.', 100), body('Go to acme.com/kuhner and use code KUHNER for 20% off.', 106), body('Free shipping and a money-back guarantee.', 112), body('Terms and conditions apply.', 118)];
const talk = [body('The president said he will visit the border next week.', 10), body('We can go to the store dot com later, who knows.', 300), body('Use the code of conduct as a guide.', 900)];
const sw = C.sponsorWindows([...talk, ...read].sort((a, b) => a.s - b.s));
assert.equal(sw.length, 1); assert.ok(sw[0].s <= 100 && sw[0].e >= 123, JSON.stringify(sw));
assert.equal(C.sponsorWindows(talk).length, 0, 'stray clues are not a sponsor read');

/* ---- labels ---- */
assert.equal(C.syncLabel('no-transcript', false), 'No transcript for this episode');
assert.match(C.syncLabel('approx', false), /Tap the line you hear/); assert.match(C.syncLabel('approx', true), /listening for a lock/);

/* ---- server: transcript route ---- */
const S = await import('./server/podcasts.ts'); const T = await import('./server/podcastTranscript.ts');
const src = S.PODCAST_SOURCES.find((x) => x.enabled && /Kuhner/.test(x.name))!;
const enc1 = 'https://podtrac.com/pts/redirect.mp3/traffic.omny.fm/d/clips/a/b/c1/audio.mp3'; const enc2 = 'https://podtrac.com/pts/redirect.mp3/traffic.omny.fm/d/clips/a/b/c2/audio.mp3';
const feed = `<?xml version="1.0"?><rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>${src.expectTitle}</title>
<item><title>With</title><guid>g1</guid><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate><enclosure url="${enc1}" type="audio/mpeg"/><itunes:duration>1557</itunes:duration><podcast:transcript url="https://cdn.example.com/t1.srt" type="application/srt"/></item>
<item><title>Without</title><guid>g2</guid><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><enclosure url="${enc2}" type="audio/mpeg"/><itunes:duration>1200</itunes:duration></item></channel></rss>`;
const asked: string[] = [];
const fake = (async (u: any) => {
  const url = String(u); asked.push(url);
  if (url === src.feedUrl) return new Response(feed, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  if (url === 'https://cdn.example.com/t1.srt') return new Response(srt, { status: 200 });
  return new Response('no', { status: 404 });
}) as typeof fetch;
S.setPodcastFetchForTests(fake);
await S.refreshPodcastSource(src, new Date('2026-11-21T12:00:00Z'));
const got = await T.transcriptFor(enc1, fake);
assert.equal(got.status, 200); assert.ok('body' in got && got.body.available && got.body.cues.length === 3 && got.body.endsAt === 62 && got.body.feedSeconds === 1557);
const none = await T.transcriptFor(enc2, fake);
assert.ok('body' in none && none.body.available === false && none.body.reason === 'no-transcript', 'an episode without a transcript says so');
const before = asked.length; await T.transcriptFor(enc1, fake); assert.equal(asked.length, before, 'second ask is served from the cache');
assert.equal((await T.transcriptFor('https://evil.example/a.mp3', fake)).status, 404, 'only enclosures the app published');
S.setPodcastFetchForTests(undefined);
console.log('podcast captions: all tests passed');
