import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const outputDir = path.resolve(process.argv[2] ?? 'test-results/epg-aired-badge');
mkdirSync(outputDir, { recursive: true });
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const port = await freePort();
const vite = spawn(process.execPath, [
  path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort',
], { stdio: 'pipe' });
let viteOutput = '';
vite.stdout.setEncoding('utf8').on('data', chunk => { viteOutput += chunk; });
vite.stderr.setEncoding('utf8').on('data', chunk => { viteOutput += chunk; });
const readyUntil = Date.now() + 20_000;
while (!viteOutput.includes(`127.0.0.1:${port}`)) {
  if (vite.exitCode !== null || Date.now() >= readyUntil) {
    vite.kill('SIGTERM');
    throw new Error(`Local Vite fixture server did not start\n${viteOutput}`);
  }
  await delay(50);
}
const managedChromium = '/repl/tools/bin/chromium';
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN }
    : existsSync(managedChromium) ? { executablePath: managedChromium } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.emulateTimezone('America/Los_Angeles');
  const externalRequests: string[] = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(`http://127.0.0.1:${port}/`) || request.url() === 'about:blank' || request.url().startsWith('data:')) void request.continue();
    else { externalRequests.push(request.url()); void request.abort(); }
  });
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['desktop', 1440, 900],
  ] as const) {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1,
      isMobile: name === 'phone',
      hasTouch: name === 'phone',
    });
    await page.goto(`http://127.0.0.1:${port}/test-epg-aired-preview.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="epg-aired-time"]').length === 3);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-epg-window-hours]');
      return el?.getAttribute('data-epg-window-hours') !== null;
    });
    const block = await page.$('#epg-prog-synthetic-fox-0');
    assert.ok(block, 'synthetic FOX schedule block must render');
    const before = await block.boundingBox();
    assert.ok(before);
    if (name === 'phone') {
      await block.tap();
      await page.waitForFunction(() => {
        const popover = document.querySelector<HTMLElement>('[data-testid="epg-aired-popover"]');
        return !!popover && getComputedStyle(popover).display !== 'none';
      });
      const after = await block.boundingBox();
      assert.deepEqual(after, before, 'showing the aired-time popover must not alter block geometry');
      const popup = await page.$eval('[data-testid="epg-aired-popover"]', element => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          text: node.textContent?.trim() ?? '',
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
        };
      });
      const expectedLabel = await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>('#epg-prog-synthetic-fox-0');
        const label = button?.querySelector<HTMLElement>('[data-testid="epg-aired-time"]')?.textContent?.trim();
        return label ?? '';
      });
      assert.equal(popup.text, expectedLabel, 'phone popover must show the full local label');
      assert.ok(popup.left >= 0 && popup.right <= width, 'phone popover must fit inside the viewport');
      assert.ok(popup.scrollWidth <= popup.clientWidth, 'phone popover text must not be clipped horizontally');
      assert.ok(popup.fontSize >= 14, 'phone popover text must remain readable');
      console.log(`PASS phone popover: full label visible at ${width}px; block rectangle unchanged`);
    } else {
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const tooltip = await page.$eval('#epg-prog-synthetic-fox-0 [data-testid="epg-aired-time"]', element =>
        (element as HTMLElement).title);
      assert.equal(tooltip, 'Aired UTC: 2026-10-08T21:00:00.000Z', 'desktop keeps the exact UTC tooltip');
      const popover = await page.$('[data-testid="epg-aired-popover"]');
      const popoverDisplay = popover
        ? await popover.evaluate(element => getComputedStyle(element).display)
        : 'none';
      assert.equal(popoverDisplay, 'none', 'the mobile overlay must not replace the desktop tooltip');
      console.log('PASS desktop tooltip: exact UTC value retained; mobile overlay hidden');
    }
    await delay(250);
    assert.equal(externalRequests.length, 0, `browser attempted external request(s): ${externalRequests.join(', ')}`);
    console.log(`PASS browser request guard: ${externalRequests.length} non-local requests`);
    const file = path.join(outputDir, `epg-aired-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`PASS screenshot ${name} ${width}x${height}: ${file}`);
  }
} finally {
  await browser.close();
  vite.kill('SIGTERM');
  await Promise.race([new Promise<void>(resolve => vite.once('close', () => resolve())), delay(5_000)]);
}
