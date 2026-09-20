import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.AJN_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(page, path) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { data = body; }
    return { status: response.status, data };
  }, path);
}

(async () => {
  console.log('=== AJN EPG RUNTIME IDENTITY REGRESSION ===');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'log' || message.type() === 'warn' || message.type() === 'error') {
        console.log('[browser]', message.text());
      }
    });

    const activations = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[AJN Playback Activation]')) {
        // Puppeteer stringifies console arguments poorly when the first argument is a label.
        // Capture the structured object from the page listener below as well.
        activations.push(text);
      }
    });

    await page.exposeFunction('__capturePlaybackActivation', (payload) => {
      activations.push(payload);
    });

    await page.goto(BASE_URL + '/#tv-guide', { waitUntil: 'networkidle2', timeout: 30000 });

    await page.evaluateOnNewDocument(() => {
      const originalLog = console.log;
      console.log = (...args) => {
        try {
          if (args[0] === '[AJN Playback Activation]' && args[1]) {
            window.__ajnPlaybackActivation = args[1];
          }
        } catch {}
        originalLog(...args);
      };
    });

    // Reload so the console interception is installed before React initializes.
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });

    console.log('\n--- M3U CANONICAL REGISTRY ---');
    const playlists = await fetchJson(page, '/api/playlists');
    assert(playlists.status === 200, `/api/playlists returned HTTP ${playlists.status}`);
    const newsPlaylist = playlists.data?.playlists?.find((item) => item.id === 'playlist-news');
    assert(newsPlaylist, 'Expected playlist-news was not present');

    const channels = await fetchJson(page, '/api/channels?guide=cable-tv');
    assert(channels.status === 200, `/api/channels returned HTTP ${channels.status}`);
    const fox = channels.data?.channels?.find((channel) => channel.id === 'fox-news');
    assert(fox, 'Expected fox-news M3U channel was not present');
    assert(Array.isArray(fox.sources) && fox.sources.length > 0, 'fox-news has no M3U source');

    const m3uSource = fox.sources[0];
    assert(typeof m3uSource.url === 'string' && m3uSource.url.length > 0, 'M3U source URL is empty');
    console.log('M3U channel: fox-news PASS');
    console.log(`M3U transport: ${m3uSource.url} PASS`);
    console.log('M3U playlist registry: PASS');

    console.log('\n--- CLASSIC TV BROWSER TRACE ---');
    await page.evaluate(() => { window.location.hash = '#tv-guide'; });
    await page.waitForFunction(() => document.querySelectorAll('button[id^="epg-prog-"]').length > 0, { timeout: 30000 });

    // Select Classic TV and force the lazy producer to materialize its canonical programs.
    await page.click('#guide-tab-classic-tv');
    await page.waitForFunction(() => document.querySelectorAll('button[id^="epg-prog-honeymooners-"]').length > 0, { timeout: 30000 });

    const schedule = await fetchJson(page, '/api/schedule?guide=classic-tv');
    assert(schedule.status === 200, `classic-tv schedule returned HTTP ${schedule.status}`);
    const classicChannel = schedule.data?.channels?.find((channel) => channel.id === 'honeymooners');
    assert(classicChannel, 'Classic TV Honeymooners channel missing');
    assert(classicChannel.programs?.length > 0, 'Classic TV produced no programs');

    const expected = classicChannel.programs[0];
    assert(expected.id && expected.sourceId && expected.assetId, 'Classic TV canonical tuple is incomplete');
    assert(![expected.id, expected.sourceId, expected.assetId].some((value) => String(value).toLowerCase() === 'unknown'), 'Classic TV contains unknown identity');

    const buttonSelector = '#epg-prog-honeymooners-0';
    await page.click(buttonSelector);
    await page.waitForFunction(() => window.__ajnPlaybackActivation != null, { timeout: 10000 });

    const firstActivation = await page.evaluate(() => window.__ajnPlaybackActivation);
    assert(firstActivation, 'No [AJN Playback Activation] payload captured');

    console.log('Classic sourceId:', firstActivation.sourceId);
    console.log('Classic programId:', firstActivation.programId);
    console.log('Classic assetId:', firstActivation.assetId);

    assert(firstActivation.sourceId === expected.sourceId, 'Classic sourceId changed between EPG and playback');
    assert(firstActivation.programId === expected.id, 'Classic programId changed between EPG and playback');
    assert(firstActivation.assetId === expected.assetId, 'Classic assetId changed between EPG and playback');
    assert(firstActivation.archivePath === expected.archivePath, 'Classic transport reference changed before playback');
    assert(firstActivation.constructedSrc, 'Classic constructedSrc is empty');
    assert(![firstActivation.sourceId, firstActivation.programId, firstActivation.assetId]
      .some((value) => String(value).toLowerCase() === 'unknown'), 'Runtime identity contains unknown');

    // Reselect the same canonical program and require tuple stability.
    await page.evaluate(() => {
      window.__ajnPlaybackActivation = null;
      window.location.hash = '#tv-guide';
    });
    await page.waitForFunction(() => document.querySelectorAll('button[id^="epg-prog-honeymooners-"]').length > 0, { timeout: 30000 });
    await page.click(buttonSelector);
    await page.waitForFunction(() => window.__ajnPlaybackActivation != null, { timeout: 10000 });
    const secondActivation = await page.evaluate(() => window.__ajnPlaybackActivation);

    assert(secondActivation.sourceId === firstActivation.sourceId, 'Classic sourceId changed on reselection');
    assert(secondActivation.programId === firstActivation.programId, 'Classic programId changed on reselection');
    assert(secondActivation.assetId === firstActivation.assetId, 'Classic assetId changed on reselection');
    assert(secondActivation.constructedSrc === firstActivation.constructedSrc, 'Classic transport changed on reselection');

    console.log('Classic tuple immutability: PASS');
    console.log('Classic transport integrity: PASS');
    console.log('Unknown identity guard: PASS');
    console.log('\n=== RESULT: PASS ===');
  } catch (error) {
    console.error('\n=== RESULT: FAIL ===');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
