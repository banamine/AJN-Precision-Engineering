// Real Chrome, real audio through the real useAudioNormalization chain: the shared master gain must never be left at 0
// after a click-free start whose play() fails (the silence regression), and restoreMaster must bring the sound back.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const port = Number(process.env.GATE_TEST_PORT || 5214), origin = `http://127.0.0.1:${port}`;
copyFileSync(process.env.TONE_WAV || '/tmp/tone.wav', 'test-master-gate.wav');
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { detached: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${origin}/test-master-gate.html`)).ok) break; } catch { /* starting */ } await delay(200); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${origin}/test-master-gate.html`);
  await page.getByTestId('go').click();
  await page.getByTestId('bridge').filter({ hasText: 'true' }).waitFor({ timeout: 15000 });
  await delay(800);
  const base = await page.evaluate(() => window.__rms());
  assert.ok(base > 0.02, `sound reaches the output at the start (rms ${base})`);
  // The click-free start mutes the master, then play() is rejected (a channel switch aborts it): the old code never restored it.
  await page.evaluate(() => window.__n.declickMaster(window.__el(), 0, 0));
  await delay(300);
  const stuck = await page.evaluate(() => window.__rms());
  assert.ok(stuck < 0.002, `reproduced: master left at 0 → silence (rms ${stuck})`);
  await page.evaluate(() => window.__n.restoreMaster(0));
  await delay(300);
  const back = await page.evaluate(() => window.__rms());
  assert.ok(back > 0.02, `restoreMaster brings the sound back (rms ${back})`);
  // restoreMaster must work even when a different element is the connected one (the case declickMaster refuses).
  await page.evaluate(() => { window.__n.declickMaster(window.__el(), 0, 0); });
  await delay(100);
  await page.evaluate(() => window.__n.restoreMaster(0.005));
  await delay(300);
  assert.ok((await page.evaluate(() => window.__rms())) > 0.02, 'a second mute/restore cycle also recovers');
  assert.deepEqual(errs, []);
  console.log(`master gate browser test ok (start ${base.toFixed(3)} → stuck ${stuck.toFixed(4)} → restored ${back.toFixed(3)})`);
} finally { await browser?.close(); try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ } rmSync('test-master-gate.wav', { force: true }); }
