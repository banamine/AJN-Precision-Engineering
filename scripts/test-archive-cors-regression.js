const puppeteer = require('puppeteer');

const BASE_URL = process.env.AJN_BASE_URL || 'http://localhost:3000';

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const corsAttributes = await page.evaluate(() => {
      const video = document.querySelector('video');
      const audio = document.querySelector('audio');
      return {
        videoCrossOrigin: video?.getAttribute('crossorigin') ?? null,
        audioCrossOrigin: audio?.getAttribute('crossorigin') ?? null,
      };
    });

    if (corsAttributes.videoCrossOrigin !== null || corsAttributes.audioCrossOrigin !== null) {
      throw new Error(`Forced crossOrigin attribute detected: ${JSON.stringify(corsAttributes)}`);
    }

    console.log('[ARCHIVE CORS REGRESSION] PASS', JSON.stringify(corsAttributes));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('[ARCHIVE CORS REGRESSION] FAIL', error.stack || error.message || error);
  process.exit(1);
});
