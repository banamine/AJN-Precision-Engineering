import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'ajn-g18b-audio-'));
const audioPath = join(work, 'synthetic.m4a');
const preloadPath = join(work, 'offline-mock.mjs');
const statsPath = join(work, 'mock-stats.json');
const id = 'The_Alex_Jones_Radio_Show_20210910_170000';
const file = `${id}.m4a`;
const archivePath = `/download/${id}/${file}`;

const preload = `
import fs from 'node:fs';
const originalFetch = globalThis.fetch;
const audio = fs.readFileSync(process.env.AJN_SYNTH_AUDIO);
const statsPath = process.env.AJN_SYNTH_STATS;
const expectedPath = process.env.AJN_SYNTH_ARCHIVE_PATH;
const stats = { syntheticArchiveResponses: 0, blockedExternalAttempts: 0, ranges: [] };
const save = () => fs.writeFileSync(statsPath, JSON.stringify(stats));
save();
globalThis.fetch = async (input, init) => {
  let url;
  try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); }
  catch { stats.blockedExternalAttempts++; save(); throw new Error('NET_GUARD=block malformed URL'); }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return originalFetch(input, init);
  if (url.protocol === 'https:' && url.hostname === 'archive.org' && url.pathname === expectedPath) {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    const range = headers.get('range') || '';
    const match = /^bytes=(\\d+)-(\\d*)$/.exec(range);
    if (!match) { stats.blockedExternalAttempts++; save(); throw new Error('NET_GUARD=block requires a byte range'); }
    const start = Number(match[1]);
    const askedEnd = match[2] ? Number(match[2]) : audio.length - 1;
    const end = Math.min(askedEnd, audio.length - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start + 1 > 8388608) {
      stats.blockedExternalAttempts++; save(); throw new Error('NET_GUARD=block invalid or oversized range');
    }
    const body = audio.subarray(start, end + 1);
    stats.syntheticArchiveResponses++;
    stats.ranges.push({ start, end, total: audio.length });
    save();
    return new Response(body, { status: 206, headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      'content-range': 'bytes ' + start + '-' + end + '/' + audio.length,
      'accept-ranges': 'bytes',
    }});
  }
  stats.blockedExternalAttempts++; save();
  throw new Error('NET_GUARD=block rejected external request');
};
`;

let serverProcess;
let browser;
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function waitForHealth(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('local production server did not become healthy');
}
async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const ended = new Promise((resolve) => serverProcess.once('exit', resolve));
  serverProcess.kill('SIGTERM');
  await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 9000))]);
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-y', audioPath], { stdio: 'ignore' });
  writeFileSync(preloadPath, preload);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      NET_GUARD: 'block',
      AJN_BOOT_WARMERS: '0',
      AJN_SYNTH_AUDIO: audioPath,
      AJN_SYNTH_STATS: statsPath,
      AJN_SYNTH_ARCHIVE_PATH: archivePath,
      NODE_OPTIONS: `--import=${preloadPath}`,
    },
  });
  await waitForHealth(origin);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin === origin) return request.continue();
    } catch {}
    return request.abort();
  });
  let proxyResponse = null;
  page.on('response', async (response) => {
    if (response.url().includes('/api/archive/proxy?')) {
      proxyResponse = { status: response.status(), contentType: response.headers()['content-type'] ?? null };
    }
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const probe = await page.evaluate((src) => {
    const audio = document.createElement('audio');
    audio.id = 'g18b-audio-probe';
    audio.controls = true;
    audio.src = src;
    document.body.append(audio);
    const button = document.createElement('button');
    button.id = 'g18b-audio-start';
    button.textContent = 'Start synthetic audio';
    button.addEventListener('click', () => { void audio.play(); });
    document.body.append(button);
    return { canPlayType: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') };
  }, `${origin}/api/archive/proxy?path=${encodeURIComponent(archivePath)}`);

  let startTime = null;
  let endTime = null;
  let playbackAdvanced = false;
  if (probe.canPlayType) {
    await page.waitForFunction(() => {
      const audio = document.querySelector('#g18b-audio-probe');
      return audio && (audio.readyState >= 1 || audio.error);
    }, { timeout: 15000 });
    await page.click('#g18b-audio-start');
    await page.waitForFunction(() => document.querySelector('#g18b-audio-probe')?.currentTime > 0.1, { timeout: 12000 });
    startTime = await page.$eval('#g18b-audio-probe', (audio) => audio.currentTime);
    await page.waitForFunction((before) => document.querySelector('#g18b-audio-probe')?.currentTime >= before + 3, { timeout: 12000 }, startTime);
    endTime = await page.$eval('#g18b-audio-probe', (audio) => audio.currentTime);
    playbackAdvanced = endTime - startTime >= 3;
  }
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
  const result = {
    syntheticFixture: true,
    canPlayType: probe.canPlayType,
    localProxyStatus: proxyResponse?.status ?? null,
    localProxyContentType: proxyResponse?.contentType ?? null,
    startSeconds: startTime,
    endSeconds: endTime,
    advancedAtLeast3Seconds: playbackAdvanced,
    syntheticArchiveResponses: stats.syntheticArchiveResponses,
    ranges: stats.ranges,
    blockedExternalAttempts: stats.blockedExternalAttempts,
  };
  console.log(JSON.stringify(result));
  if (!probe.canPlayType) {
    console.log('NOT SUPPORTED: this Chromium reports no AAC/M4A support.');
  } else {
    assert.equal(proxyResponse?.status, 206);
    assert.equal(proxyResponse?.contentType, 'audio/mp4');
    assert.ok(playbackAdvanced, 'synthetic proxied AAC/M4A did not advance by 3 seconds');
    console.log('PASS: Chromium decoded and advanced through the synthetic local proxy response.');
  }
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
  rmSync(work, { recursive: true, force: true });
}
