import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const viteEntry = require.resolve('vite');
const viteBin = path.resolve(path.dirname(viteEntry), '../../bin/vite.js');
const host = '127.0.0.1';
const port = Number(process.env.SHOWINFO_TEST_PORT || 5178);
const origin = `http://${host}:${port}`;
const outputDir = path.resolve(process.env.SCREENSHOT_DIR || 'generated-artifacts/showinfo-popover');
const captureOnly = process.argv.includes('--capture-only');
const server = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
let browser;

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/test-showinfo-popover.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready:\n${serverOutput}`);
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const externalRequests = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/test-showinfo-popover.html`, { waitUntil: 'networkidle' });

  for (const fixture of ['movies-fixture', 'news-fixture']) {
    const section = page.getByTestId(fixture);
    await section.getByRole('button', { name: /^About / }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'More info' }).click();
    const text = await dialog.innerText();
    const archiveLinks = await dialog.locator('a[href*="archive.org"]').count();
    if (captureOnly) {
      assert.match(text, /Source status: snapshot/);
      assert.match(text, /\d+ distinct titles? today/);
      assert.match(text, /No curated description is available yet/);
      assert.equal(archiveLinks, 1, `${fixture} baseline includes its Archive link`);
    } else {
      assert.doesNotMatch(text, /Source:|Source status|Open on Internet Archive|No curated description|Built from this channel/i);
      assert.equal(archiveLinks, 0, `${fixture} has no Archive link`);
      if (fixture === 'movies-fixture') {
        assert.match(text, /13 programs today · 78 distinct titles in rotation/);
      }
      if (fixture === 'news-fixture') {
        assert.match(text, /1 program today/);
        assert.doesNotMatch(text, /titles in rotation/);
      }
    }
    await dialog.screenshot({ path: path.join(outputDir, `${captureOnly ? 'before' : 'after'}-${fixture}.png`) });
    await dialog.getByRole('button', { name: 'Close show information' }).click();
  }

  assert.deepEqual(externalRequests, [], 'popover test must not make non-local requests');
  assert.deepEqual(errors, [], 'popover test has no browser exceptions');
  if (!captureOnly) console.log('[showinfo-popover] PASS — Movies and News dialogs, no Archive link/placeholders, external requests blocked');
  console.log(`screenshots=${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 2_000);
      server.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
});
