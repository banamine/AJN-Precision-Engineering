import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const root = process.cwd();
const port = Number(process.env.PLAYER_LAYOUT_TEST_PORT || 5197);
const origin = `http://127.0.0.1:${port}`;
const screenshots = path.resolve(root, "..", "player-split-captions-layout-delivery", "screenshots");
const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, NET_GUARD: "block", NODE_ENV: "test" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let viteOutput = "";
vite.stdout.on("data", (chunk) => { viteOutput += String(chunk); });
vite.stderr.on("data", (chunk) => { viteOutput += String(chunk); });
let browser;

async function stopVite() {
  if (vite.exitCode !== null) return;
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  await Promise.race([new Promise((resolve) => vite.once("exit", resolve)), delay(2000)]);
  if (vite.exitCode === null) {
    try { process.kill(-vite.pid, "SIGKILL"); } catch { vite.kill("SIGKILL"); }
  }
}

async function waitForVite() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited ${vite.exitCode}\n${viteOutput}`);
    try {
      const response = await fetch(`${origin}/test-player-captions-layout.html`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(100);
  }
  throw new Error(`Vite did not become ready\n${viteOutput}`);
}

async function main() {
  await mkdir(screenshots, { recursive: true });
  await waitForVite();
  const executablePath = process.env.CHROMIUM_PATH || (await access("/repl/tools/bin/chromium").then(() => "/repl/tools/bin/chromium").catch(() => chromium.executablePath()));
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let scenario = "cc5";
  let apiRequests = [];
  const consoleErrors = [];
  const blockedExternalAttempts = new Set();
  const navMeasurements = {};
  await page.addInitScript(() => {
    let mediaTime = 180;
    try { window.localStorage.setItem("ajn.captionOverlay.v1", "off"); } catch { /* private mode is also covered by app code */ }
    Object.defineProperty(window, "__testSetMediaTime", { value: (value) => { mediaTime = value; } });
    window.setInterval(() => { mediaTime += 0.25; }, 250);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => mediaTime,
      set: (value) => { mediaTime = Number(value) || 0; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function () { this.dispatchEvent(new Event("playing")); return Promise.resolve(); },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: function () { this.dispatchEvent(new Event("pause")); },
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("net::ERR_BLOCKED_BY_CLIENT")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) blockedExternalAttempts.add(`${url.host}${url.pathname}`);
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:") return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.route("**/synthetic-*.mp4", (route) => route.fulfill({
    status: 200,
    contentType: "video/mp4",
    body: "",
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    apiRequests.push(url.pathname);
    if (url.pathname === "/api/captions/plan") {
      const body = scenario === "none"
        ? { source: "none", label: "SYNTHETIC TEST — no captions" }
        : scenario === "asr"
          ? { source: "asr", kind: "asr", label: "SYNTHETIC TEST — Automatic speech recognition by Internet Archive, not broadcaster captions" }
          : scenario === "align"
            ? { source: "align", kind: "aligned", label: "SYNTHETIC TEST — Broadcast closed captions via Internet Archive" }
            : { source: "cc5", kind: "broadcast-cc", label: "SYNTHETIC TEST — Broadcast closed captions via Internet Archive" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (url.pathname === "/api/captions/slice") {
      const cues = Array.from({ length: 200 }, (_, index) => ({
        start: index,
        end: index + 0.8,
        text: `SYNTHETIC CUE ${String(index + 1).padStart(3, "0")}`,
      }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cues }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  const viewports = [
    [1440, 900], [1366, 768], [1280, 720], [1024, 768],
    [768, 1024], [390, 844], [844, 390],
  ];
  const scenarios = ["cc5", "align", "asr", "none", "ineligible", "live", "nonarchive", "movie", "radio"];
  const rows = [];
  for (const currentScenario of scenarios) {
    scenario = currentScenario;
    apiRequests = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/test-player-captions-layout.html?scenario=${currentScenario}&route=player`, { waitUntil: "domcontentloaded" });
    await page.locator("#persistent-player").waitFor({ state: "visible" });
    if (currentScenario === "cc5") {
      navMeasurements.desktop = await page.locator("#canonical-app-header").evaluate((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        position: getComputedStyle(element).position,
      }));
    }
    if (["cc5", "align", "asr"].includes(currentScenario)) {
      try {
        await page.getByTestId("captions-history").waitFor({ state: "visible", timeout: 8000 });
      } catch (error) {
        const debug = await page.evaluate(() => Object.fromEntries(
          ["#canonical-main-viewport", "#persistent-player", '[data-testid="player-page-layout"]', ".ajn-player-page-video", ".ajn-player-page-lower", ".ajn-player-page-left", ".ajn-player-page-right", '[data-testid="captions-panel"]', '[data-testid="captions-history"]']
            .map((selector) => {
              const element = document.querySelector(selector);
              const rect = element?.getBoundingClientRect();
              const style = element ? getComputedStyle(element) : null;
              return [selector, rect && style ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility, overflow: style.overflow } : null];
            }),
        ));
        console.log(`CAPTION_DEBUG ${currentScenario}: requests=${JSON.stringify(apiRequests)} layout=${JSON.stringify(debug)} text=${(await page.locator("body").innerText()).slice(0, 600)}`);
        throw error;
      }
    } else if (currentScenario === "none") {
      await page.getByText("No captions for this program.").waitFor({ state: "visible", timeout: 8000 });
    } else {
      await delay(350);
    }
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => {
        const main = document.querySelector("#canonical-main-viewport");
        const layout = document.querySelector('[data-testid="player-page-layout"]');
        const signature = [document.documentElement.scrollHeight, main?.clientHeight ?? 0, layout?.clientHeight ?? 0, layout?.scrollHeight ?? 0];
        const previous = (window).__playerLayoutSignature;
        (window).__playerLayoutSignature = signature;
        return previous?.every((value, index) => value === signature[index]) ?? false;
      }, { polling: 100, timeout: 4000 });
      if (currentScenario === "cc5" && width === 390 && height === 844) {
        navMeasurements.mobile = await page.locator("#canonical-app-header").evaluate((element) => ({
          height: Math.round(element.getBoundingClientRect().height),
          position: getComputedStyle(element).position,
          bottomNavHeight: Math.round(document.querySelector("#mobile-bottom-nav")?.getBoundingClientRect().height ?? 0),
          bottomNavPosition: document.querySelector("#mobile-bottom-nav") ? getComputedStyle(document.querySelector("#mobile-bottom-nav")).position : "missing",
        }));
      }
      const metrics = await page.evaluate(() => {
        const video = document.querySelector("video");
        const videoRect = video?.getBoundingClientRect();
        const aside = document.querySelector(".ajn-player-page-right");
        const panel = document.querySelector('[data-testid="captions-history"], [data-testid="captions-none"], [data-testid="captions-planning"], [data-testid="captions-error"], [data-testid="captions-paused"]');
        const panelRect = (aside ?? panel)?.getBoundingClientRect();
        return {
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          mainOverflowY: getComputedStyle(document.querySelector("#canonical-main-viewport")).overflowY,
          video: videoRect ? { x: Math.round(videoRect.x), y: Math.round(videoRect.y), width: Math.round(videoRect.width), height: Math.round(videoRect.height), bottom: Math.round(videoRect.bottom) } : null,
          caption: panelRect ? { x: Math.round(panelRect.x), y: Math.round(panelRect.y), width: Math.round(panelRect.width), height: Math.round(panelRect.height) } : null,
          sidebar: Boolean(aside || panel),
          phase: document.querySelector('[data-testid="player-page-layout"]')?.getAttribute("data-caption-phase") ?? "audio",
        };
      });
      const isAudioScenario = currentScenario === "radio";
      const documentFits = metrics.documentHeight <= metrics.viewportHeight;
      const scrollOk = documentFits || isAudioScenario;
      const scrollResult = documentFits ? "PASS" : isAudioScenario ? "AUDIO FLOW" : "FAIL";
      const bottomOk = !metrics.video || metrics.video.bottom <= metrics.viewportHeight;
      const aspectOk = !metrics.video || Math.abs(metrics.video.width / metrics.video.height - 16 / 9) <= 0.03;
      if (!scrollOk || !bottomOk || !aspectOk) {
        const debugRects = await page.evaluate(() => Object.fromEntries(
          ["#canonical-app-shell", "#canonical-main-viewport", "#persistent-player", '[data-testid="player-page-layout"]', ".ajn-player-page-left", ".ajn-player-page-video", ".ajn-player-page-right", '[data-testid="captions-history"]']
            .map((selector) => {
              const element = document.querySelector(selector);
              const rect = element?.getBoundingClientRect();
              return [selector, rect ? { y: Math.round(rect.y), height: Math.round(rect.height), scrollHeight: element?.scrollHeight } : null];
            }),
        ));
        console.log(`LAYOUT_DEBUG ${currentScenario} ${width}x${height}: ${JSON.stringify(debugRects)}`);
      }
      assert.equal(scrollOk, true, `${currentScenario} ${width}x${height}: document scroll ${metrics.documentHeight}/${metrics.viewportHeight}`);
      assert.equal(bottomOk, true, `${currentScenario} ${width}x${height}: video bottom ${metrics.video?.bottom}/${metrics.viewportHeight}`);
      assert.equal(aspectOk, true, `${currentScenario} ${width}x${height}: video aspect ${metrics.video ? `${metrics.video.width}/${metrics.video.height}` : "audio-only"} must be 16:9`);
      if (["ineligible", "live", "nonarchive", "movie"].includes(currentScenario)) {
        assert.equal(metrics.phase, "off", `${currentScenario} must not request TV captions`);
        assert.equal(apiRequests.some((request) => request.startsWith("/api/captions/")), false, `${currentScenario} made a caption request`);
        assert.equal(metrics.sidebar, false, `${currentScenario} must not reserve a caption sidebar`);
      }
      if (["cc5", "align", "asr", "none"].includes(currentScenario)) assert.equal(metrics.sidebar, true);
      if (currentScenario === "radio") {
        assert.notEqual(metrics.mainOverflowY, "hidden", "audio Player route must retain normal page-flow scrolling");
      }
      rows.push({
        scenario: currentScenario,
        width,
        height,
        scroll: scrollResult,
        video: metrics.video,
        videoBottom: bottomOk ? "PASS" : "FAIL",
        videoAspect: aspectOk ? "PASS" : "FAIL",
        captionRect: metrics.caption,
        sidebar: metrics.sidebar ? "Y" : "N",
        phase: metrics.phase,
        captionRequests: apiRequests.filter((request) => request.startsWith("/api/captions/")).length,
      });
      if (currentScenario === "cc5" && width === 1440 && height === 900) {
        await page.getByTestId("caption-overlay-toggle").click();
        await page.getByTestId("caption-overlay").waitFor({ state: "visible" });
        await page.screenshot({ path: path.join(screenshots, "player-1440x900.png") });
      }
      if (currentScenario === "asr" && width === 1280 && height === 720) {
        assert.equal(await page.getByTestId("captions-label").evaluate((element) => element.textContent), "SYNTHETIC TEST — Automatic speech recognition by Internet Archive, not broadcaster captions");
        await page.screenshot({ path: path.join(screenshots, "player-1280x720.png") });
      }
      if (currentScenario === "cc5" && width === 390 && height === 844) await page.screenshot({ path: path.join(screenshots, "player-390x844.png") });
    }
  }

  scenario = "cc5";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/test-player-captions-layout.html?scenario=cc5&route=player`, { waitUntil: "domcontentloaded" });
  const history = page.getByTestId("captions-history");
  await history.waitFor({ state: "visible", timeout: 8000 });
  await page.evaluate(() => window.__testSetMediaTime(180));
  await delay(700);
  const initialScroll = await history.evaluate((node) => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight }));
  assert.ok(initialScroll.height > initialScroll.client, "200 synthetic cues should overflow only the caption list");
  assert.ok(initialScroll.top + initialScroll.client >= initialScroll.height - 3, "caption history initially follows live");
  await page.evaluate(() => window.__testSetMediaTime(190));
  await delay(800);
  const afterCue = await history.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 3);
  assert.equal(afterCue, true, "caption history autoscrolls while following live");
  await history.evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
  await page.getByTestId("captions-jump-to-live").waitFor({ state: "visible" });
  await page.evaluate(() => window.__testSetMediaTime(199));
  await delay(800);
  const pausedScroll = await history.evaluate((node) => node.scrollTop);
  assert.ok(pausedScroll < 15, "user scroll-up stops autoscroll");
  await page.getByTestId("captions-jump-to-live").click();
  assert.ok(await history.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 3), "Jump to live resumes autoscroll");

  await page.goto(`${origin}/test-player-captions-layout.html?scenario=cc5&route=player`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("captions-history").waitFor({ state: "visible", timeout: 8000 });
  assert.equal(await page.locator('[data-testid="mini-player-dock"]').count(), 0, "mini-player dock is absent on the Player route");
  await page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) throw new Error("synthetic video element missing");
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.srclang = "en";
    track.label = "English";
    track.src = "/synthetic-subtitles.vtt";
    track.dataset.ajnSubtitles = "en";
    Object.defineProperty(track, "readyState", { configurable: true, value: 2 });
    video.append(track);
  });
  await page.getByTestId("subtitle-toggle").waitFor({ state: "visible", timeout: 3000 });
  await page.getByTestId("subtitle-toggle").click();
  await page.getByTestId("caption-overlay-toggle").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("caption-overlay-toggle").isDisabled(), true, "native English subtitles disable the overlay control");
  assert.equal(await page.getByTestId("caption-overlay").count(), 0, "native subtitles and the in-player overlay must never show together");

  const regressionRows = [];
  for (const routeName of ["home", "tv-guide", "library", "radio"]) {
    await page.goto(`${origin}/test-player-captions-layout.html?scenario=cc5&route=${routeName}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`page-${routeName}`).waitFor({ state: "visible" });
    const before = await page.evaluate(() => ({
      hidden: getComputedStyle(document.getElementById("persistent-player")).display === "none",
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      currentTime: document.querySelector("video")?.currentTime ?? 0,
      dock: getComputedStyle(document.querySelector('[data-testid="mini-player-dock"]')).display !== "none",
    }));
    await delay(500);
    const afterTime = await page.locator("video").evaluate((node) => node.currentTime);
    assert.equal(before.hidden, true, `${routeName}: persistent player wrapper must remain hidden`);
    assert.ok(before.scrollHeight > before.viewportHeight, `${routeName}: normal page scrolling remains available`);
    assert.ok(afterTime > before.currentTime, `${routeName}: synthetic media clock continues while hidden`);
    assert.equal(before.dock, true, `${routeName}: mini dock is visible off the player page`);
    regressionRows.push({ route: routeName, hidden: before.hidden, scroll: `${before.scrollHeight}>${before.viewportHeight}`, clockAdvanced: afterTime > before.currentTime, dock: before.dock });
  }

  await page.goto(`${origin}/test-player-captions-layout.html?scenario=cc5&route=player`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("captions-history").waitFor({ state: "visible", timeout: 8000 });
  await page.evaluate(() => window.__testSetMediaTime(180));
  await delay(700);
  await page.getByTestId("caption-overlay-toggle").click();
  await page.getByTestId("caption-overlay").waitFor({ state: "visible" });
  await page.locator('button[aria-label="Fullscreen"]').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  const fullscreen = await page.evaluate(() => {
    const stage = document.fullscreenElement;
    return {
      stageContainsVideo: Boolean(stage?.querySelector("video")),
      overlayInStage: Boolean(stage?.querySelector('[data-testid="caption-overlay"]')),
      sidebarInStage: Boolean(stage?.querySelector(".ajn-player-page-right")),
    };
  });
  assert.deepEqual(fullscreen, { stageContainsVideo: true, overlayInStage: true, sidebarInStage: false });
  await page.keyboard.press("Escape");

  const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.includes("net::ERR_BLOCKED_BY_CLIENT"));
  assert.deepEqual(unexpectedConsoleErrors, [], `browser console errors: ${unexpectedConsoleErrors.join(" | ")}`);
  assert.equal([...blockedExternalAttempts].some((request) => /(^|\.)archive\.org\//i.test(request)), false, `an Archive request escaped the test stub: ${[...blockedExternalAttempts].join(", ")}`);
  console.log("SYNTHETIC_PLAYER_LAYOUT_MATRIX");
  console.log("scenario | viewport | document scrollHeight<=innerHeight (AUDIO FLOW = preserved normal audio scroll) | video rect | video bottom<=viewport | video aspect 16:9 | caption panel rect | sidebar | phase | /api/captions request count");
  for (const row of rows) console.log(`${row.scenario} | ${row.width}x${row.height} | ${row.scroll} | ${row.video ? `${row.video.x},${row.video.y},${row.video.width},${row.video.height}` : "audio-only"} | ${row.videoBottom} | ${row.videoAspect} | ${row.captionRect ? `${row.captionRect.x},${row.captionRect.y},${row.captionRect.width},${row.captionRect.height}` : "none"} | ${row.sidebar} | ${row.phase} | ${row.captionRequests}`);
  console.log(`NAV_MEASUREMENTS: ${JSON.stringify(navMeasurements)} (the measured --ajn-nav-h combines visible top header and mobile bottom tabs; top header is sticky, bottom tabs fixed)`);
  console.log("SYNTHETIC_200_CUE_HISTORY: initial-bottom PASS; auto-follow PASS; user-scroll stops PASS; Jump to live resumes PASS");
  console.log(`PLAYER_ROUTE_REGRESSION_FIXTURE: ${JSON.stringify(regressionRows)}`);
  console.log(`NATIVE_SUBTITLES_EXCLUSION: overlay disabled and absent while English subtitles are showing`);
  console.log(`BROWSER_JS_ERRORS: ${unexpectedConsoleErrors.length}`);
  console.log(`FULLSCREEN: ${JSON.stringify(fullscreen)}`);
  console.log(`TEST_GUARD_BLOCKED_EXTERNAL_ATTEMPTS: ${blockedExternalAttempts.size} unique (${[...blockedExternalAttempts].join(", ") || "none"}); archive.org attempts: 0`);
  console.log(`SCREENSHOTS: ${screenshots}`);
}

try {
  await main();
} finally {
  if (browser) await browser.close();
  await stopVite();
}
