// Real browser, real audio: a 60 s WAV (speech-level tone with two pauses) through the real analyser + useSilenceSkip.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const SR = 8000, DUR = 60, port = Number(process.env.SKIP_TEST_PORT || 5213), origin = `http://127.0.0.1:${port}`;
const tone = (t) => (t < 15 || (t >= 18 && t < 30) || t >= 34) ? 0.1 * Math.sin(2 * Math.PI * 300 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) : 0; // −20 dBFS-ish, syllable-like envelope
const pcm = Buffer.alloc(SR * DUR * 2); for (let i = 0; i < SR * DUR; i++) pcm.writeInt16LE(Math.round(tone(i / SR) * 32767), i * 2);
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync('test-silence-skip.wav', Buffer.concat([h, pcm]));
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { detached: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${origin}/test-silence-skip.html`)).ok) break; } catch { /* starting */ } await delay(200); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${origin}/test-silence-skip.html`); await page.getByTestId('state').filter({ hasText: 'on' }).waitFor({ timeout: 15000 });
  await page.evaluate(() => { const a = document.querySelector('[data-testid=a]'); a.currentTime = 12; return a.play(); });
  await delay(14000);                                   // content 12 s → ~ past the first pause (15–18) at 4×
  const log = await page.evaluate(() => window.__log);
  const during = log.filter(([t]) => t > 15.8 && t < 17.6), after = log.filter(([t]) => t > 19 && t < 22);
  assert.ok(during.length > 0 && during.some(([, r]) => r === 4), `engaged during the pause: ${JSON.stringify(during.slice(0, 5))}`);
  assert.ok(after.length > 0 && after.every(([, r]) => r === 1), 'normal speed once speech is back');
  const wallPause = (() => { const a = log.find(([t]) => t >= 15), b = log.find(([t]) => t >= 18.2); return b && a ? (b[2] - a[2]) / 1000 : NaN; })();
  assert.ok(wallPause < 2.6, `the 3 s pause took ${wallPause.toFixed(2)} s of wall time (expected ≈ 0.5 + 2.5/4)`);
  assert.ok(Number(await page.getByTestId('saved').textContent()) >= 1, 'saved-time counter ran');
  assert.deepEqual(errs, []);
  console.log(`silence skip browser test ok (3 s pause played in ${wallPause.toFixed(2)} s)`);
} finally { await browser?.close(); try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ } rmSync('test-silence-skip.wav', { force: true }); }
