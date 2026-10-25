import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createServer } from "vite";
import { radioFixturePlan, radioFixtureSliceBody, RADIO_FIXTURE_ID } from "./test-radio-caption-fixtures.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const screenshots = path.join(root, "REVIEW", "screens");
fs.mkdirSync(screenshots, { recursive: true });
process.env.DISABLE_HMR = "true";

function makeSilentWav(seconds = 10, sampleRate = 8000) {
  const sampleBytes = 2;
  const dataBytes = seconds * sampleRate * sampleBytes;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * sampleBytes, 28); wav.writeUInt16LE(sampleBytes, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

const wav = makeSilentWav();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const vite = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  appType: "spa",
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false },
});
await vite.listen();
const address = vite.httpServer.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/repl/tools/bin/chromium";
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
let blockedExternal = 0;

function planResponse(mode) {
  if (mode === "plan404") return { status: 404, body: { error: "transcript_unavailable", message: "No public machine transcript listed for this item", source: "asr" } };
  return { status: 200, body: radioFixturePlan() };
}

async function createTestPage(mode, viewport, identifier = RADIO_FIXTURE_ID) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  const run = { mode, requests: [], starts: [], externalBlocked: 0 };
  page.on("request", async (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== origin) {
      blockedExternal += 1; run.externalBlocked += 1;
      return request.abort("blockedbyclient").catch(() => {});
    }
    if (requestUrl.pathname === "/stub.wav") {
      return request.respond({ status: 200, contentType: "audio/wav", headers: { "Accept-Ranges": "bytes", "Content-Length": String(wav.length) }, body: wav }).catch(() => {});
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      const record = { path: requestUrl.pathname + requestUrl.search, at: Date.now() };
      run.requests.push(record);
      if (requestUrl.pathname.endsWith("/plan") && requestUrl.pathname.startsWith("/api/audio-asr/")) {
        const r = planResponse(mode);
        return request.respond({ status: r.status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(r.body) }).catch(() => {});
      }
      if (requestUrl.pathname.startsWith("/api/audio-asr/") && requestUrl.pathname.endsWith("/slice")) {
        const raw = requestUrl.searchParams.get("t") ?? "0/60";
        const start = Number(raw.split("/")[0]);
        run.starts.push(start);
        if (mode === "slice503") {
          const body = { error: "slice_upstream", message: "synthetic slice unavailable", source: "asr" };
          return request.respond({ status: 503, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
        }
        if (mode === "slice429") {
          const body = { error: "slice_upstream", message: "synthetic rate limit", source: "asr" };
          return request.respond({ status: 429, contentType: "application/json", headers: { "Retry-After": "7" }, body: JSON.stringify(body) }).catch(() => {});
        }
        return request.respond({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(radioFixtureSliceBody(start)) }).catch(() => {});
      }
      if (requestUrl.pathname === "/api/captions/plan") {
        const body = { source: "cc5", kind: "broadcast-cc", label: "BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE" };
        return request.respond({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) }).catch(() => {});
      }
      if (requestUrl.pathname === "/api/captions/slice") {
        const start = Number(requestUrl.searchParams.get("start") ?? "0");
        const body = { source: "cc5", kind: "broadcast-cc", label: "BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE", cues: radioFixtureSliceBody(start).cues };
        return request.respond({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) }).catch(() => {});
      }
      return request.respond({ status: 404, contentType: "application/json", body: "{}" }).catch(() => {});
    }
    return request.continue().catch(() => {});
  });
  const query = new URLSearchParams({ mode, id: identifier });
  await page.goto(`${origin}/test-radio-caption-browser.html?${query}`, { waitUntil: "networkidle0" });
  return { page, run };
}

async function waitForSelector(page, selector, timeout = 7000) {
  await page.waitForSelector(selector, { timeout });
}
async function waitForSlice(run, start, page, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!run.starts.includes(start) && Date.now() < deadline) await sleep(100);
  assert.ok(run.starts.includes(start), `slice ${start} was not requested`);
}

try {
  // E3: actual hook lifecycle with a fake HTMLMediaElement playhead.
  const e3 = await createTestPage("e3", { width: 1280, height: 800 });
  await pageWait(e3.page, () => window.__captionDemo !== undefined);
  await waitForSelector(e3.page, '[data-testid="captions-current"]');
  await e3.page.waitForFunction(() => document.querySelector('[data-testid="captions-current"]')?.textContent?.includes("SYNTHETIC_FIXTURE_T0_02"), { timeout: 6000 });
  await e3.page.evaluate(() => window.__captionDemo.setTime(35));
  await waitForSlice(e3.run, 60, e3.page);
  const beforePausedCount = e3.run.starts.length;
  await e3.page.evaluate(() => { window.__captionDemo.setPaused(true); window.__captionDemo.setTime(95); });
  await sleep(800);
  assert.equal(e3.run.starts.length, beforePausedCount, "paused media must not fetch the next slice");
  await e3.page.evaluate(() => { window.__captionDemo.setPaused(false); window.__captionDemo.setTime(7080); });
  await waitForSlice(e3.run, 7080, e3.page);
  const e3PlanCount = e3.run.requests.filter((r) => r.path.endsWith("/plan")).length;
  assert.equal(e3PlanCount, 1);
  assert.deepEqual(e3.run.starts, [0, 60, 7080]);
  assert.ok(e3.run.requests.length <= 20);
  console.log(`E3 hook: plans=${e3PlanCount}, slices=${JSON.stringify(e3.run.starts)}, pausedNoFetch=true, perMinute=${e3.run.requests.length}/20`);
  await e3.page.close();

  // E4: API failures and invalid ID behavior.
  const plan404 = await createTestPage("plan404", { width: 800, height: 600 });
  await waitForSelector(plan404.page, '[data-testid="captions-none"]');
  assert.equal(plan404.run.requests.length, 1);
  await plan404.page.close();

  const slice503 = await createTestPage("slice503", { width: 800, height: 600 });
  await waitForSelector(slice503.page, '[data-testid="captions-error"]');
  assert.match(await slice503.page.$eval('[data-testid="captions-error"]', (e) => e.textContent ?? ""), /synthetic slice unavailable/);
  assert.deepEqual(slice503.run.starts, [0]);
  await slice503.page.close();

  const slice429 = await createTestPage("slice429", { width: 800, height: 600 });
  await waitForSelector(slice429.page, '[data-testid="captions-paused"]');
  assert.match(await slice429.page.$eval('[data-testid="captions-paused"]', (e) => e.textContent ?? ""), /about [67] s/);
  await sleep(1200);
  assert.deepEqual(slice429.run.starts, [0], "a 429 slice gets one attempt; no automatic retry");
  await slice429.page.close();

  const invalid = await createTestPage("invalid", { width: 800, height: 600 }, "not-a-radio-id");
  await sleep(700);
  assert.equal(await invalid.page.$('[data-testid="captions-panel"]'), null);
  assert.equal(invalid.run.requests.length, 0);
  await invalid.page.close();
  console.log("E4 states: plan404=none, slice503=error(reason preserved), slice429=paused(7s, one attempt), invalidId=off/0 requests");

  // E5: phone/desktop screenshots, auto appearance/current advancement, and News-vs-radio height.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const radio = await createTestPage("radio", viewport);
    await waitForSelector(radio.page, '[data-testid="captions-current"]');
    await radio.page.waitForFunction(() => document.querySelector('[data-testid="captions-current"]')?.textContent?.includes("SYNTHETIC_FIXTURE_T0_00"), { timeout: 6000 });
    const initial = await radio.page.$eval('[data-testid="captions-current"]', (e) => e.textContent?.trim() ?? "");
    await radio.page.evaluate(() => window.__captionDemo.setTime(4.2));
    await radio.page.waitForFunction((old) => (document.querySelector('[data-testid="captions-current"]')?.textContent?.trim() ?? "") !== old, { timeout: 4000 }, initial);
    const moved = await radio.page.$eval('[data-testid="captions-current"]', (e) => e.textContent?.trim() ?? "");
    assert.notEqual(moved, initial, "caption line follows the audio playhead");
    const label = await radio.page.$eval('[data-testid="captions-label"]', (e) => e.textContent?.trim() ?? "");
    assert.equal(label, "RADIO CAPTIONS VIA INTERNET ARCHIVE · MACHINE-GENERATED (ASR, MAY CONTAIN ERRORS)");
    const screenName = viewport.width === 390 ? "radio-caption-390.png" : "radio-caption-1440.png";
    await radio.page.screenshot({ path: path.join(screenshots, screenName), fullPage: true });
    console.log(`E5 ${viewport.width}px: auto=${radio.run.requests.length > 0}, labelExact=true, currentAdvanced=${initial} -> ${moved}, screenshot=${screenName}`);
    await radio.page.close();
  }

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const compare = await createTestPage("compare", viewport);
    await compare.page.waitForFunction(() => document.querySelector('[data-testid="radio-compare"] [data-testid="captions-current"]')?.textContent?.length > 0
      && document.querySelector('[data-testid="news-compare"] [data-testid="captions-current"]')?.textContent?.length > 0, { timeout: 7000 });
    const heights = await compare.page.evaluate(() => ({
      radio: document.querySelector('[data-testid="radio-compare"] [data-testid="captions-panel"]').getBoundingClientRect().height,
      news: document.querySelector('[data-testid="news-compare"] [data-testid="captions-panel"]').getBoundingClientRect().height,
    }));
    assert.ok(heights.radio <= heights.news, `${viewport.width}px radio strip ${heights.radio}px > News strip ${heights.news}px`);
    console.log(`E5 height ${viewport.width}px: radio=${heights.radio}px <= news=${heights.news}px`);
    await compare.page.close();
  }
  const news = await createTestPage("news", { width: 1440, height: 900 });
  await waitForSelector(news.page, '[data-testid="captions-current"]');
  await news.page.waitForFunction(() => document.querySelector('[data-testid="captions-current"]')?.textContent?.includes("SYNTHETIC_FIXTURE_T0_"), { timeout: 6000 });
  assert.equal(await news.page.$('[data-testid="radio-compare"]'), null);
  assert.equal(await news.page.$eval('[data-testid="captions-label"]', (e) => e.textContent?.trim() ?? ""), "BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE");
  await news.page.screenshot({ path: path.join(screenshots, "news-caption-unchanged-1440.png"), fullPage: true });
  await news.page.close();
  const screenshotNames = fs.readdirSync(screenshots).sort();
  assert.deepEqual(screenshotNames, ["news-caption-unchanged-1440.png", "radio-caption-1440.png", "radio-caption-390.png"]);
  console.log(`E5 screenshots: ${JSON.stringify(screenshotNames)}; blocked external requests=${blockedExternal}`);
  console.log(`PASS: no external host reached; synthetic local/API requests only.`);
} finally {
  await browser.close();
  await vite.close();
}

async function pageWait(page, fn) {
  await page.waitForFunction(fn, { timeout: 5000 });
}
