import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ORIGIN = 'http://127.0.0.1:8080';
const LIMIT = 32 * 1024 * 1024;

async function bodyWithinLimit(response: Response) {
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) < LIMIT, 'response must remain below 32 MiB');
  return text;
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
  await writeFile(candidateFile, JSON.stringify({ ids: fixtureIds, numFound: fixtureIds.length, pages: 1, requests: 0, fetchedAt: new Date().toISOString() }));
  await writeFile(itemFile, JSON.stringify(Object.fromEntries(fixtureIds.map((id) => [id, {
    fetchedAt: Date.now(),
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
    env: { NODE_ENV: 'production', PORT: '8080', NET_GUARD: 'block', AJN_BOOT_WARMERS: '0' },
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
    const byStationName = (rows: any[]) => [...rows].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id)));
    const stationsAfter = byStationName(scheduleBody.channels);
    const stationIndex = stationsAfter.findIndex((c) => c.id === 'archive-infowars-radio');
    const stationsBefore = byStationName(scheduleBody.channels.filter((c: any) => c.id !== 'archive-infowars-radio'));
    const adjacentStations = [stationsAfter[stationIndex - 1], stationsAfter[stationIndex + 1]].filter(Boolean).map((neighbor) => ({
      name: neighbor.name,
      before: stationsBefore.findIndex((c) => c.id === neighbor.id) + 1,
      after: stationsAfter.findIndex((c) => c.id === neighbor.id) + 1,
    }));
    const afterBytes = Buffer.byteLength(scheduleText);
    const without = JSON.stringify({ ...scheduleBody, channels: scheduleBody.channels.filter((c: any) => c.id !== 'archive-infowars-radio') });
    const beforeBytes = Buffer.byteLength(without);
    const deltaBytes = afterBytes - beforeBytes;
    assert.ok(afterBytes < 24 * 1024 * 1024, `audio schedule under 24 MiB, got ${afterBytes}`);
    assert.ok(afterBytes < LIMIT, `audio schedule under 32 MiB, got ${afterBytes}`);
    assert.ok(deltaBytes > 0 && deltaBytes < 8 * 1024 * 1024, `new channel delta under advisory 8 MiB, got ${deltaBytes}`);

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
    console.log('PASS: production Cloud Run bundle /api/health 200, 17-show/4-genre shelf, bad-show JSON 404, bad-ASR JSON 400, ASR plan/slice JSON');
    console.log(`PASS: exact audio channel, JSON=${afterBytes} bytes, channel delta=${deltaBytes} bytes, XML programmes=${xmlPrograms} schedule programs=${scheduledPrograms}`);
    console.log(`Station order: new=${stationIndex + 1}/${stationsAfter.length}; neighbours=${JSON.stringify(adjacentStations)}`);
    console.log(`PASS: response bodies <32 MiB; NET_GUARD blocked attempts=${networkCounts.blocked}; physical Archive starts=${networkCounts.archiveStarts}; SIGTERM shutdown <10s`);
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
