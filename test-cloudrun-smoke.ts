import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ORIGIN = 'http://127.0.0.1:8080';
const LIMIT = 32 * 1024 * 1024;
const FIXTURE_TIME = Date.parse('2026-10-20T12:15:00.000Z');

async function bodyWithinLimit(response: Response) {
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) < LIMIT, 'response must remain below 32 MiB');
  return text;
}

async function runBudgetTest() {
  const child = spawn(process.execPath, ['test-music-schedule-budget.mjs', ORIGIN], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { ...result, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function verifyAudioFlagOff(guardPath: string, countPath: string) {
  const port = 8081;
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', guardPath, 'dist/server.cjs'], {
    cwd: process.cwd(),
    env: { NODE_ENV: 'production', PORT: String(port), NET_GUARD: 'block', AJN_BOOT_WARMERS: '0', AJN_AUDIO_LIGHT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  let exited = false;
  const exitPromise = new Promise<void>((resolve) => child.once('exit', () => { exited = true; resolve(); }));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready && !exited; attempt++) {
      try { ready = (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (!ready) await delay(200);
    }
    assert.ok(ready, `flag-off server did not become ready: ${stdout.slice(-500)} ${stderr.slice(-500)}`);
    const full = await fetch(`${origin}/api/schedule?guide=audio-podcasts&tz=420`, { headers: { 'accept-encoding': 'identity' } });
    const light = await fetch(`${origin}/api/schedule?guide=audio-podcasts&tz=420&light=1`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(full.status, 200);
    assert.equal(light.status, 200);
    const fullBody = Buffer.from(await full.arrayBuffer());
    const lightBody = Buffer.from(await light.arrayBuffer());
    assert.ok(fullBody.equals(lightBody), 'AJN_AUDIO_LIGHT=0 returns byte-identical full body for light and no-light requests');
    assert.equal(light.headers.get('X-AJN-Light-Raw-Bytes'), null, 'disabled path uses the original full response headers');
    child.kill('SIGTERM');
    await Promise.race([exitPromise, delay(10_000).then(() => { throw new Error('flag-off server did not stop within 10 seconds'); })]);
    const counts = JSON.parse((await readFile(countPath, 'utf8')).trim());
    assert.equal(counts.archiveStarts, 0);
    return { flagOffRawBytes: fullBody.length, bodyEqual: true, archiveStarts: counts.archiveStarts, blockedAttempts: counts.blocked };
  } finally {
    if (!exited) child.kill('SIGKILL');
  }
}

async function run() {
  const guardDir = await mkdtemp(path.join(tmpdir(), 'ajn-g17-net-guard-'));
  const guardPath = path.join(guardDir, 'guard.mjs');
  const countPath = path.join(guardDir, 'blocked-count');
  const cacheDir = path.join(process.cwd(), '.cache');
  const candidateFile = path.join(cacheDir, 'infowars-candidate-ids.json');
  const itemFile = path.join(cacheDir, 'infowars-item-files.json');
  const previousCandidate = await readFile(candidateFile).catch(() => null);
  const previousItems = await readFile(itemFile).catch(() => null);
  const fixtureIds = Array.from({ length: 8 }, (_, i) => `The_Alex_Jones_Radio_Show_2026100${i + 1}_120000`);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(candidateFile, JSON.stringify({ ids: fixtureIds, numFound: fixtureIds.length, pages: 1, requests: 0, fetchedAt: new Date(FIXTURE_TIME).toISOString() }));
  await writeFile(itemFile, JSON.stringify(Object.fromEntries(fixtureIds.map((id) => [id, {
    fetchedAt: FIXTURE_TIME,
    metadata: { identifier: id, files: [
      { name: `${id}.m4a`, private: 'false', source: 'original', format: 'M4A', length: '10800', size: '43000000' },
      { name: `${id}.m4a.asr.srt`, private: 'false', length: '100', size: '2048' },
    ] },
  }]))));
  const guardSource = `
import { writeFileSync } from 'node:fs';
let blocked = 0, archiveStarts = 0, syntheticAsrSlices = 0;
const countFile = new URL('./blocked-count', import.meta.url);
const originalFetch = globalThis.fetch;
const fixedNow = Date.parse('2026-10-20T12:15:00.000Z');
class FrozenDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedNow])); } static now() { return fixedNow; } }
globalThis.Date = FrozenDate;
const saveCounts = () => writeFileSync(countFile, JSON.stringify({ blocked, archiveStarts, syntheticAsrSlices }));
globalThis.fetch = async (input, init) => {
  let url;
  try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); }
  catch { blocked++; saveCounts(); throw new Error('NET_GUARD blocked non-URL request'); }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return originalFetch(input, init);
  if (url.hostname === 'archive.org' && url.pathname.endsWith('.asr.srt') && url.searchParams.has('t')) {
    syntheticAsrSlices++;
    saveCounts();
    return new Response('1\\n00:00:12,000 --> 00:00:13,000\\nDEMO synthetic transcript only\\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  blocked++;
  saveCounts();
  throw new Error('NET_GUARD=block rejected outbound request');
};
saveCounts();
`;
  await writeFile(guardPath, guardSource);

  const child = spawn(process.execPath, ['--import', guardPath, 'dist/server.cjs'], {
    cwd: process.cwd(),
    env: { NODE_ENV: 'production', PORT: '8080', NET_GUARD: 'block', AJN_BOOT_WARMERS: '0', AJN_AUDIO_LIGHT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  let exited = false;
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); });
  });

  try {
    let ready: Response | null = null;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && !exited) {
      try {
        ready = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (ready.ok) break;
      } catch {}
      await delay(200);
    }
    assert.ok(ready?.ok, `Cloud Run bundle did not become ready; stdout=${stdout.slice(-1200)} stderr=${stderr.slice(-1200)}`);
    const healthText = await bodyWithinLimit(ready);
    assert.ok(healthText.length > 0);

    const shows = await fetch(`${ORIGIN}/api/classic-radio/shows`);
    assert.equal(shows.status, 200);
    assert.match(shows.headers.get('content-type') ?? '', /application\/json/i);
    const showText = await bodyWithinLimit(shows);
    const showBody = JSON.parse(showText);
    assert.equal(showBody.schemaVersion, 1);
    assert.equal(showBody.totalShows, 17);
    assert.equal(showBody.genres.length, 4);

    const badShow = await fetch(`${ORIGIN}/api/classic-radio/search?show=not-a-real-show`);
    assert.equal(badShow.status, 404);
    assert.match(badShow.headers.get('content-type') ?? '', /application\/json/i);
    const badShowText = await bodyWithinLimit(badShow);
    assert.equal(JSON.parse(badShowText).error, 'unknown_show');

    const unsafe = await fetch(`${ORIGIN}/api/archive/proxy?path=${encodeURIComponent('https://example.invalid/audio.mp3')}`);
    assert.ok(unsafe.status >= 400 && unsafe.status < 500, `unlisted host rejected with ${unsafe.status}`);
    const unsafeText = await bodyWithinLimit(unsafe);
    assert.ok(unsafeText.length > 0);

    const fixtureId = fixtureIds[0];
    const badAsr = await fetch(`${ORIGIN}/api/audio-asr/not-valid/plan`);
    assert.equal(badAsr.status, 400);
    assert.match(badAsr.headers.get('content-type') ?? '', /application\/json/i);
    assert.equal((await badAsr.json() as any).error, 'invalid_identifier');
    const asrPlan = await fetch(`${ORIGIN}/api/audio-asr/${fixtureId}/plan`);
    assert.equal(asrPlan.status, 200);
    const asrPlanBody = await asrPlan.json() as any;
    assert.equal(asrPlanBody.source, 'asr');
    assert.equal(asrPlanBody.label, 'Machine transcript (Archive ASR, may contain errors)');
    const asrSlice = await fetch(`${ORIGIN}/api/audio-asr/${fixtureId}/slice?t=0%2F60`);
    assert.equal(asrSlice.status, 200);
    const asrSliceBody = await asrSlice.json() as any;
    assert.equal(asrSliceBody.source, 'asr');
    assert.equal(asrSliceBody.label, 'Machine transcript (Archive ASR, may contain errors)');
    assert.equal(asrSliceBody.cues.length, 1);
    assert.equal(asrSliceBody.cues[0].start, 12);
    assert.equal(asrSliceBody.bytes > 0, true);

    let scheduleBody: any = null;
    let scheduleText = '';
    const scheduleDeadline = Date.now() + 30_000;
    while (Date.now() < scheduleDeadline) {
      const schedule = await fetch(`${ORIGIN}/api/schedule?guide=audio-podcasts`, { headers: { 'accept-encoding': 'identity' } });
      assert.equal(schedule.status, 200);
      scheduleText = await bodyWithinLimit(schedule);
      scheduleBody = JSON.parse(scheduleText);
      const channel = scheduleBody.channels.find((c: any) => c.id === 'archive-infowars-radio');
      if (channel && channel.sourceStatus !== 'loading' && channel.programs.length > 0) break;
      await delay(250);
    }
    const channel = scheduleBody?.channels?.find((c: any) => c.id === 'archive-infowars-radio');
    assert.ok(channel, 'INFOWARS channel is present in audio guide payload');
    assert.equal(channel.name, 'INFOWARS Archive RADIO');
    assert.ok(channel.programs.length >= 8, `expected fixture lineup, got ${channel.programs.length}`);
    const afterBytes = Buffer.byteLength(scheduleText);
    const without = JSON.stringify({ ...scheduleBody, channels: scheduleBody.channels.filter((c: any) => c.id !== 'archive-infowars-radio') });
    const beforeBytes = Buffer.byteLength(without);
    const deltaBytes = afterBytes - beforeBytes;
    assert.ok(afterBytes < 24 * 1024 * 1024, `audio schedule under 24 MiB, got ${afterBytes}`);
    assert.ok(afterBytes < LIMIT, `audio schedule under 32 MiB, got ${afterBytes}`);
    assert.ok(deltaBytes > 0 && deltaBytes < 8 * 1024 * 1024, `new channel delta under advisory 8 MiB, got ${deltaBytes}`);
    assert.equal(afterBytes, 16_472_936, 'no-light audio response matches the pre-change Cloud Run smoke fixture byte count');

    const audioTzResponse = await fetch(`${ORIGIN}/api/schedule?guide=audio-podcasts&tz=420`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(audioTzResponse.status, 200);
    const audioTzText = await bodyWithinLimit(audioTzResponse);
    const audioTzBody = JSON.parse(audioTzText);
    const audioLightResponse = await fetch(`${ORIGIN}/api/schedule?guide=audio-podcasts&light=1&tz=420`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(audioLightResponse.status, 200);
    const audioLightText = await bodyWithinLimit(audioLightResponse);
    const audioLightRawBytes = Buffer.byteLength(audioLightText);
    assert.equal(Number(audioLightResponse.headers.get('X-AJN-Light-Raw-Bytes')), audioLightRawBytes);
    assert.ok(audioLightRawBytes < 8 * 1024 * 1024, `light audio under 8 MiB, got ${audioLightRawBytes}`);
    const musicId = 'item-music-00s-radio-hits-2024';
    const fullTzMusic = audioTzBody.channels.find((item: any) => item.id === musicId);
    const lightMusic = JSON.parse(audioLightText).channels.find((item: any) => item.id === musicId);
    assert.ok(fullTzMusic && lightMusic);
    assert.equal(lightMusic.programCount, fullTzMusic.programs.length);
    assert.equal(lightMusic.programsComplete, false);
    assert.equal(lightMusic.programs.length, 3);
    const channelResponse = await fetch(`${ORIGIN}/api/schedule?guide=audio-podcasts&channel=${encodeURIComponent(musicId)}&tz=420`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(channelResponse.status, 200);
    const channelText = await bodyWithinLimit(channelResponse);
    const channelPayload = JSON.parse(channelText);
    const channelFull = channelPayload.channels.find((item: any) => item.id === musicId);
    assert.ok(channelFull);
    const channelRawBytes = Buffer.byteLength(channelText);
    assert.deepEqual(channelFull.programs.map((program: any) => ({ id: program.id, startHour: program.startHour, endHour: program.endHour })),
      fullTzMusic.programs.map((program: any) => ({ id: program.id, startHour: program.startHour, endHour: program.endHour })));
    assert.ok(lightMusic.programs.every((program: any) => channelFull.programs.some((fullProgram: any) => fullProgram.id === program.id)));

    const audioEpg = await fetch(`${ORIGIN}/api/guides/audio-podcasts/epg.xml`);
    const audioM3u = await fetch(`${ORIGIN}/api/guides/audio-podcasts/playlist.m3u`);
    const audioEpgHash = createHash('sha256').update(await bodyWithinLimit(audioEpg)).digest('hex');
    const audioM3uHash = createHash('sha256').update(await bodyWithinLimit(audioM3u)).digest('hex');
    assert.equal(audioEpgHash, 'd1055ce1213ba405c89a6dbb9091a1ccbd4c875246007428364c4b494cf2b8d6', 'audio XML export matches pre-change hash');
    assert.equal(audioM3uHash, 'dc78896c145a39e2e3230b6f9a2a5de43a51e6eaae22b931d4bee2104201d07c', 'audio playlist export matches pre-change hash');

    const budgetTest = await runBudgetTest();
    assert.match(budgetTest.stdout, /"lightTz"/, 'budget test reports the audio light budget before other guide checks');
    console.log(`Budget test output: ${budgetTest.stdout.replace(/\n/g, ' | ')}${budgetTest.code === 0 ? '' : ` | EXIT ${budgetTest.code}: ${budgetTest.stderr}`}`);

    const xmlResponse = await fetch(`${ORIGIN}/api/channels/archive-infowars-radio/epg.xml?guide=audio-podcasts`);
    assert.equal(xmlResponse.status, 200);
    const xml = await bodyWithinLimit(xmlResponse);
    const xmlPrograms = [...xml.matchAll(/<programme\b[^>]*\bchannel="archive-infowars-radio"/g)].length;
    const scheduledPrograms = channel.programs.filter((p: any) => p.startTimeUtc && p.endTimeUtc && Date.parse(p.endTimeUtc) > Date.parse(p.startTimeUtc)).length;
    assert.equal(xmlPrograms, scheduledPrograms, `XML programmes ${xmlPrograms} equal schedule programs ${scheduledPrograms}`);

    child.kill('SIGTERM');
    const shutdown = await Promise.race([
      exitPromise,
      delay(10_000).then(() => null),
    ]);
    assert.ok(shutdown, 'server must exit within 10 seconds after SIGTERM');
    assert.ok(shutdown.signal === 'SIGTERM' || shutdown.code === 0, 'SIGTERM should terminate cleanly');
    const networkCounts = JSON.parse((await readFile(countPath, 'utf8').catch(() => '{"blocked":0,"archiveStarts":0,"syntheticAsrSlices":0}')).trim());
    assert.equal(networkCounts.archiveStarts, 0, 'NET_GUARD allowed zero physical Archive starts');
    assert.equal(networkCounts.syntheticAsrSlices, 1, 'ASR route used one in-memory synthetic slice');
    const flagOff = await verifyAudioFlagOff(guardPath, countPath);
    console.log('PASS: production Cloud Run bundle /api/health 200, 17-show/4-genre shelf, bad-show JSON 404, bad-ASR JSON 400, ASR plan/slice JSON');
    console.log(`PASS: exact audio channel, JSON=${afterBytes} bytes, channel delta=${deltaBytes} bytes, XML programmes=${xmlPrograms} schedule programs=${scheduledPrograms}`);
    console.log(`Audio E1/E2: default=${afterBytes} B; tz=${Buffer.byteLength(audioTzText)} B; light+tz=${audioLightRawBytes} B; channel=${channelRawBytes} B; 3 light IDs=${lightMusic.programs.map((program: any) => program.id).join(',')}`);
    console.log(`Audio E3 exports unchanged: epg.xml=${audioEpgHash}; playlist.m3u=${audioM3uHash}`);
    console.log(`Audio E6 flag-off: ${JSON.stringify(flagOff)}`);
    console.log(`PASS: response bodies <32 MiB; NET_GUARD blocked attempts=${networkCounts.blocked}; physical Archive starts=${networkCounts.archiveStarts}; SIGTERM shutdown <10s`);
    if (budgetTest.code !== 0) {
      console.error(`FAIL: existing schedule budget test exit=${budgetTest.code}; ${budgetTest.stderr}`);
      process.exitCode = 1;
    }
  } finally {
    if (!exited) child.kill('SIGKILL');
    await rm(guardDir, { recursive: true, force: true });
    if (previousCandidate) await writeFile(candidateFile, previousCandidate); else await unlink(candidateFile).catch(() => {});
    if (previousItems) await writeFile(itemFile, previousItems); else await unlink(itemFile).catch(() => {});
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : 'smoke failed');
  process.exitCode = 1;
});
