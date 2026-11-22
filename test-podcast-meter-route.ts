import { bridgeSrc, podcastMeterVia, podcastAllowsMeter, corsModeFor } from './src/utils/mediaRoute';
import { resolveEnclosure, isResolvedFinal, isKnownEnclosure } from './server/podcasts';
let fails = 0; const eq = (n: string, a: unknown, b: unknown) => { if (a !== b) { fails++; console.error('FAIL', n, a, b); } };
// routing per feed
eq('direct', podcastMeterVia('pod-kuhner-report-abc'), 'direct');
eq('resolve', podcastMeterVia('pod-pat-gray-x'), 'resolve');
eq('proxy', podcastMeterVia('pod-bannon-war-room-x'), 'proxy');
eq('savage proxy', podcastMeterVia('pod-savage-nation-1'), 'proxy');
eq('unknown feed none', podcastMeterVia('pod-nope-1'), undefined);
eq('all 21 flagged', ['quash','rush-limbaugh-wisdom','ben-ferguson','clay-buck','kuhner-report','pat-gray','red-eye-radio','jeff-fisher','radiolab','lead-pedal','mats-trucking-great','talkcdl','truck-n-hustle','tucker-carlson','charlie-kirk'].every((i) => podcastAllowsMeter(`pod-${i}-x`)), true);
// proxy feeds go same-origin up front; others stay direct; NO_METER skips the proxy
const enc = 'https://chrt.fm/track/x/storage.warroom.org/a.mp3?a=1&b=2';
eq('proxy src', bridgeSrc(enc, 'pod-bannon-war-room-1'), `/api/podcast/proxy?url=${encodeURIComponent(enc)}`);
eq('proxy src cors mode', corsModeFor(bridgeSrc(enc, 'pod-bannon-war-room-1'), false, 'pod-bannon-war-room-1'), 'anonymous');
eq('direct feed untouched', bridgeSrc(enc, 'pod-kuhner-report-1'), enc);
eq('no programId untouched', bridgeSrc(enc), enc);
eq('nometer not proxied', bridgeSrc(enc + '#nometer', 'pod-bannon-war-room-1'), enc + '#nometer');
// server: only URLs we resolved are proxy-eligible
(async () => {
  const final = 'https://cdn.example.com/ep.mp3?sig=1';
  const stub = (async () => new Response(null, { status: 206, headers: { 'content-type': 'audio/mpeg' } })) as unknown as typeof fetch;
  eq('not resolved yet', isResolvedFinal(final), false);
  eq('unknown enclosure', isKnownEnclosure('https://evil.example/x.mp3'), false);
  try { await resolveEnclosure('https://tracker.example.com/a.mp3', stub); } catch (e) { /* stub has no redirect: final = same URL */ }
  eq('resolved final registered', isResolvedFinal('https://tracker.example.com/a.mp3'), true);
  eq('random url not eligible', isResolvedFinal('http://169.254.169.254/latest'), false);
  console.log(fails ? `FAILED ${fails}` : '[podcast-meter-route] PASS: per-feed routing, proxy src same-origin, nometer skip, resolved-only eligibility');
  process.exit(fails ? 1 : 0);
})();
