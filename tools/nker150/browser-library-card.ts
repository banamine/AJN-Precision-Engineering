import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const base = new URL(process.env.AJN_TEST_URL ?? 'http://127.0.0.1:3110');
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) throw new Error('local-only screenshot required');
const tempPath = '/tmp/ajn-nker150-library-card-final.png';
let blockedProxyRequests = 0;
let blockedExternalHosts: string[] = [];

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/archive/proxy')) {
        blockedProxyRequests += 1;
        void request.abort('blockedbyclient');
      } else if (url.startsWith(`${base.origin}/`) || /^(data|blob|about):/.test(url)) {
        void request.continue();
      } else {
        try { blockedExternalHosts.push(new URL(url).host); } catch { blockedExternalHosts.push('unparseable'); }
        void request.abort('blockedbyclient');
      }
    });
    await page.goto(base.origin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Library');
      button?.click();
    });
    await page.waitForSelector('#lib-cat-btn-nker150-special', { timeout: 20_000 });
    await page.click('#lib-cat-btn-nker150-special');
    await page.waitForSelector('#play-lib-item-ia-01_20200728_20200728_1511', { timeout: 20_000 });
    const cardText = await page.$eval('#play-lib-item-ia-01_20200728_20200728_1511', (button) =>
      button.closest('div.group')?.textContent?.trim() ?? '',
    );
    assert.ok(cardText.includes('The Alex Jones Show January 2019 (HD)'));
    assert.ok(cardText.includes('Rights review pending; withheld from the standard collection.'));
    await page.screenshot({ path: tempPath, fullPage: true });
    console.log(JSON.stringify({
      screenshot: 'tools/nker150/evidence/03-library-card-final.png',
      itemVisible: cardText.includes('The Alex Jones Show January 2019 (HD)'),
      proxyRequestsBlockedBeforeServer: blockedProxyRequests,
      externalHostsBlocked: [...new Set(blockedExternalHosts)],
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().then(() => {
  const out = path.resolve('tools/nker150/evidence/03-library-card-final.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(tempPath, out);
}).catch((error) => {
  console.error(`final Library card screenshot failed: ${(error as Error).stack ?? String(error)}`);
  process.exitCode = 1;
});
