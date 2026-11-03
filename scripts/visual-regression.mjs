#!/usr/bin/env node
// Visual regression screenshots of EVERY page the app can route to, with images actually loaded.
//
// Usage: node scripts/visual-regression.mjs [outDir]      (env AJN_TEST_URL, default http://localhost:8080)
//
// Why this exists (2026-11-02): the CI step only captured 5 of the app's destinations, and a
// fullPage screenshot only paints images already in the viewport, so every `loading="lazy"`
// card below the fold came out as a blank box. This script
//   1. visits every Destination in src/types.ts that App.tsx can route to,
//   2. forces lazy images to load, scrolls the whole page, and waits for them,
//   3. writes report.json with per-page image counts and failed image requests, so a missing
//      image is evidence in the artifact rather than something you have to spot by eye.
// It never fails the build because Archive thumbnails are remote; it prints a summary instead.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = (process.env.AJN_TEST_URL || 'http://localhost:8080').replace(/\/$/, '');
const OUT = process.argv[2] || '/tmp/ajn-visual';

// [file name, hash]. Hashes are the ones getDestinationFromHash() in src/App.tsx accepts.
// NOTE: 'watch-later' is deliberately absent: the app has no route for it yet (the hash falls
// through to Home), so a screenshot would silently be a second picture of Home.
export const PAGES = [
  ['home', ''],
  ['guide', '#tv-guide'],
  ['player', '#player'],
  ['library', '#library'],
  ['search', '#search'],
  ['news', '#news'],
  ['news-cube', '#news-cube'],
  ['radio', '#radio'],
  ['today', '#today'],
  ['history', '#history'],
  ['dev', '#dev'],
];

// Images come from remote hosts through a concurrency-limited queue; CI is slower than a dev box.
const ONLY = (process.env.AJN_VISUAL_PAGES || '').split(',').map((x) => x.trim()).filter(Boolean);
const IMAGE_WAIT_MS = 75_000;

async function settleImages(page) {
  // 1. Lazy images below the fold never start loading in a fullPage capture: make them eager.
  await page.evaluate(() => {
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
  });
  // 2. Scroll the whole page in steps so IntersectionObserver-driven thumbnails also mount.
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight + step; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 450));
    }
    window.scrollTo(0, 0);
  });
  // 3. Wait for the images to actually arrive. <LaneImage> (src/components/LaneImage.tsx) only assigns
  //    `src` after it is near the viewport AND wins a slot in a browser-wide, concurrency-limited
  //    thumbnail queue, so right after scrolling many <img> have NO src yet and count as `complete`.
  //    "Everything complete" is therefore not enough: wait until nothing is pending and the number of
  //    loaded images has stopped growing for ~2.5 s, capped at IMAGE_WAIT_MS.
  const deadline = Date.now() + IMAGE_WAIT_MS;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const sig = await page.evaluate(() => {
      const imgs = Array.from(document.images);
      const pending = imgs.filter((i) => (i.currentSrc || i.getAttribute('src')) && !i.complete).length;
      const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
      const noSrc = imgs.filter((i) => !(i.currentSrc || i.getAttribute('src'))).length;
      // Page height is part of the signature: guide rows / cards that are still being added also mean "not settled".
      return `${pending}/${loaded}/${noSrc}/${document.documentElement.scrollHeight}`;
    });
    if (sig !== last) { last = sig; stableSince = Date.now(); }
    else if (last.startsWith('0/') && Date.now() - stableSince >= 2500) break;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const report = { base: BASE, capturedAt: new Date().toISOString(), pages: {} };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1360, height: 768 });
    let failedImages = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) failedImages.push(`${res.status()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'image') failedImages.push(`${req.failure()?.errorText || 'failed'} ${req.url()}`);
    });

    for (const [name, hash] of PAGES.filter(([n]) => !ONLY.length || ONLY.includes(n))) {
      failedImages = [];
      // The app streams media and polls, so the network never goes fully idle.
      // Navigate to about:blank first so a hash-only change still does a real page load.
      await page.goto('about:blank');
      await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000, concurrency: 2 }).catch(() => {});
      await settleImages(page);
      const stats = await page.evaluate(() => {
        const imgs = Array.from(document.images);
        return {
          title: document.title,
          hash: window.location.hash,
          images: imgs.length,
          loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
          // An <img> with no src at all is a placeholder the app chose not to fill; count it apart
          // from a real image whose URL failed to load.
          noSrc: imgs.filter((i) => !(i.currentSrc || i.getAttribute('src'))).length,
          broken: imgs.filter((i) => (i.currentSrc || i.getAttribute('src')) && i.complete && i.naturalWidth === 0).length,
          pending: imgs.filter((i) => !i.complete).length,
          height: document.documentElement.scrollHeight,
        };
      });
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      report.pages[name] = { hash, ...stats, failedImageRequests: [...new Set(failedImages)].slice(0, 25) };
      console.log(`[visual] ${name.padEnd(10)} images ${stats.loaded}/${stats.images} loaded, ${stats.broken} broken, ${stats.noSrc} no-src, ${stats.pending} pending, height ${stats.height}px`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const expected = ONLY.length ? PAGES.filter(([n]) => ONLY.includes(n)).length : PAGES.length;
  const total = Object.keys(report.pages).length;
  console.log(`[visual] captured ${total}/${expected} pages into ${OUT}`);
  if (total !== expected) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
