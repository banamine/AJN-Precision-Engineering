#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const puppeteer = require("puppeteer");

const BASE_URL = (process.env.AJN_TEST_URL || "http://localhost:3000").replace(/\/+$/, "");
const REPORT_DIR = path.resolve(process.env.AJN_HLS_REPORT_DIR || "reports/live-hls");
const SAMPLE_MS = 2_000;
const CLEANUP_MS = 60_000;
const STALL_MS = 25_000;
const RECOVERY_MS = 30_000;
const CONTROL_MS = 10 * 60_000;
const HLS_RE = /^https?:\/\/jmp2\.uk\/plu-[0-9a-f]{24}\.m3u8(?:\?.*)?$/i;
const SEGMENT_RE = /\.(?:ts|m4s|aac|mp4)(?:\?|$)/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bufferRanges(ranges) {
  const result = [];
  for (let i = 0; i < ranges.length; i++) result.push([ranges.start(i), ranges.end(i)]);
  return result;
}

function plutoSegmentRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return /(?:pluto|siloh)/i.test(url.hostname) && SEGMENT_RE.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

async function chooseChannel() {
  const response = await fetch(`${BASE_URL}/api/schedule?guide=live-tv`);
  if (!response.ok) throw new Error(`live-tv schedule returned HTTP ${response.status}`);
  const schedule = await response.json();
  for (const channel of schedule.channels || []) {
    const programs = Array.isArray(channel.programs) ? channel.programs : [];
    const index = programs.findIndex((program) => HLS_RE.test(String(program.mediaUrl || "")));
    if (index >= 0) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        programIndex: index,
        programTitle: programs[index].title,
        sourceHost: new URL(programs[index].mediaUrl).hostname,
      };
    }
  }
  throw new Error("No live-tv schedule entry matched https://jmp2.uk/plu-<24hex>.m3u8");
}

async function attachProbe(page, channel) {
  await page.addInitScript(() => {
    window.__ajnHlsProbeEnabled = true;
    window.__ajnHlsEvents = [];
    window.__ajnMediaEvents = [];
    window.__ajnMediaLoadCalls = [];
    window.__ajnMediaSessionActions = Object.create(null);
    const originalLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function (...args) {
      if (this instanceof HTMLVideoElement) {
        window.__ajnMediaLoadCalls.push({ at: Date.now(), currentTime: this.currentTime || 0 });
      }
      return originalLoad.apply(this, args);
    };
    const session = navigator.mediaSession;
    if (session) {
      try {
        const original = session.setActionHandler?.bind(session);
        Object.defineProperty(session, "setActionHandler", {
          configurable: true,
          value(action, handler) {
            window.__ajnMediaSessionActions[action] = handler;
            try { return original?.(action, handler); } catch { return undefined; }
          },
        });
      } catch { /* browser does not allow wrapping MediaSession */ }
    }
  });

  await page.goto(`${BASE_URL}/#tv-guide`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const liveTab = page.getByRole("tab", { name: /Live TV/ });
  await liveTab.waitFor({ state: "visible", timeout: 45_000 });
  await liveTab.click();

  // The guide mounts only its first 40 channels. Filter by the channel name
  // first so the selected API schedule row is actually rendered in the UI.
  await page.getByTestId("epg-search").fill(channel.channelName);
  const blockId = `epg-prog-${channel.channelId}-${channel.programIndex}`;
  const programBlock = page.locator(`[id="${blockId}"]`);
  await programBlock.waitFor({ state: "visible", timeout: 60_000 });
  await programBlock.click();
  await page.locator("video").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__ajnHlsInstance), null, { timeout: 30_000 });
  await page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) throw new Error("player video element missing after selecting live channel");
    for (const type of ["waiting", "stalled", "seeking"]) {
      video.addEventListener(type, () => {
        window.__ajnMediaEvents.push({ at: Date.now(), event: type, currentTime: video.currentTime || 0, readyState: video.readyState, networkState: video.networkState });
      });
    }
  });
  return {
    currentUrl: page.url(),
    status: await page.locator('[data-testid="player-status"]').first().textContent().catch(() => null),
  };
}

async function snapshot(page, phase) {
  return page.evaluate((phaseName) => {
    const video = document.querySelector("video");
    if (!video) return { at: Date.now(), phase: phaseName, error: "video element missing" };
    const status = document.querySelector('[data-testid="player-status"]')?.textContent?.trim() ?? "";
    const hlsEvents = window.__ajnHlsEvents || [];
    const mediaEvents = window.__ajnMediaEvents || [];
    const loadCalls = window.__ajnMediaLoadCalls || [];
    return {
      at: Date.now(),
      phase: phaseName,
      currentTime: video.currentTime || 0,
      buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]),
      seekable: Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      status,
      loadCount: loadCalls.length,
      lastLoadCalls: loadCalls.slice(-3),
      hlsEventCount: hlsEvents.length,
      lastHlsEvents: hlsEvents.slice(-6),
      lastMediaEvents: mediaEvents.slice(-6),
    };
  }, phase);
}

async function sampleFor(page, samples, phase, durationMs) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    samples.push(await snapshot(page, phase));
    await sleep(Math.min(SAMPLE_MS, Math.max(0, durationMs - (Date.now() - start))));
  }
  samples.push(await snapshot(page, phase));
}

async function waitForPlaybackProgress(page, timeoutMs) {
  const first = await snapshot(page, "progress-baseline");
  const initial = Number(first.currentTime) || 0;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(1_000);
    const current = await snapshot(page, "progress-check");
    if (!current.paused && current.readyState >= 2 && current.currentTime > initial + 0.5) return { ok: true, initial, current };
  }
  return { ok: false, initial, current: await snapshot(page, "progress-timeout") };
}

async function run() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const channel = await chooseChannel();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || await puppeteer.executablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const result = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    browser: "Chromium via Playwright",
    channel,
    constants: { sampleSeconds: SAMPLE_MS / 1000, cleanSeconds: CLEANUP_MS / 1000, stallSeconds: STALL_MS / 1000, recoverySeconds: RECOVERY_MS / 1000, controlSeconds: CONTROL_MS / 1000 },
    scenarios: {},
    segmentBlockCount: 0,
    samples: [],
    mediaSessionPreviousSupported: false,
    startOverVisible: false,
    consoleErrors: [],
    pageErrors: [],
  };
  let blockSegments = false;
  const blockedSegments = [];
  let page;

  const newProbePage = async () => {
    const created = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    created.setDefaultTimeout(30_000);
    created.on("pageerror", (error) => result.pageErrors.push(error.message));
    created.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text().slice(0, 300));
    });
    created.on("requestfailed", (request) => {
      const url = request.url();
      result.samples.push({ at: Date.now(), phase: "requestfailed", host: (() => { try { return new URL(url).hostname; } catch { return ""; } })(), failure: request.failure()?.errorText || "" });
    });
    await created.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (blockSegments && plutoSegmentRequest(requestUrl)) {
        let host = "";
        let extension = "";
        try {
          const parsed = new URL(requestUrl);
          host = parsed.hostname;
          extension = path.extname(parsed.pathname).toLowerCase();
        } catch { /* ignore malformed URL */ }
        blockedSegments.push({ at: Date.now(), host, extension });
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    return created;
  };

  const startSession = async () => {
    const p = await newProbePage();
    const ui = await attachProbe(p, channel);
    const progress = await waitForPlaybackProgress(p, 90_000);
    return { page: p, ui, progress };
  };

  try {
    const first = await startSession();
    page = first.page;
    result.scenarios.S1 = { ui: first.ui, started: first.progress.ok, firstProgress: first.progress.current, cleanPlayback: false };
    if (!first.progress.ok) {
      result.scenarios.S1.note = "No clean playback before forced stall; S1 is inconclusive and the prescribed scenario was not started.";
    } else {
      result.scenarios.S1.cleanPlayback = true;
      await sampleFor(page, result.samples, "S1-clean-before", CLEANUP_MS);
      const beforeBlock = await snapshot(page, "S1-before-block");
      const blockStart = Date.now();
      blockSegments = true;
      await sampleFor(page, result.samples, "S1-segments-blocked", STALL_MS);
      blockSegments = false;
      const unblockAt = Date.now();
      result.segmentBlockCount = blockedSegments.length;
      const recoveryStart = await snapshot(page, "S1-unblocked");
      let recoveredAt = null;
      const recoveryDeadline = unblockAt + RECOVERY_MS;
      while (Date.now() < recoveryDeadline) {
        const sample = await snapshot(page, "S1-recovery");
        result.samples.push(sample);
        if (!sample.paused && sample.readyState >= 2 && sample.currentTime > recoveryStart.currentTime + 0.5) {
          recoveredAt = sample.at;
          break;
        }
        await sleep(SAMPLE_MS);
      }
      result.samples.push(await snapshot(page, "S1-recovery-end"));
      const s1Samples = [
        beforeBlock,
        ...result.samples.filter((sample) => String(sample.phase).startsWith("S1-") && sample.at >= blockStart),
      ];
      const backwardJump = s1Samples.some((sample, index) => index > 0 && Number(sample.currentTime) + 2 < Number(s1Samples[index - 1].currentTime));
      const s1Hls = await page.evaluate(() => window.__ajnHlsEvents || []);
      const s1Loads = await page.evaluate(() => window.__ajnMediaLoadCalls || []);
      const forced = result.samples.filter((sample) => sample.at >= blockStart && sample.at <= unblockAt);
      const reconnectStatus = forced.some((sample) => /Reconnecting/.test(sample.status || ""));
      const stallErrors = s1Hls.filter((event) => event.event === "ERROR" && (/bufferAppendError|manifestLoadError|mediaError|bufferStalledError/i.test(`${event.details} ${event.type}`) || event.fatal === true));
      result.scenarios.S1 = {
        ...result.scenarios.S1,
        beforeBlock,
        blockStart,
        unblockAt,
        blockedRequestCount: blockedSegments.length,
        recoverySeconds: recoveredAt === null ? null : Number(((recoveredAt - unblockAt) / 1000).toFixed(2)),
        recoveredWithin30s: recoveredAt !== null,
        reconnectStatus,
        mediaLoadCountBefore: beforeBlock.loadCount,
        mediaLoadCountAfter: s1Loads.length,
        mediaLoadDuringStall: s1Loads.some((call) => call.at >= blockStart && call.at <= unblockAt),
        backwardJump,
        hlsErrorSummary: stallErrors.map((event) => ({ at: event.at, type: event.type, details: event.details, fatal: event.fatal, status: event.status })),
        hlsEvents: s1Hls,
      };

      const startBefore = await snapshot(page, "S2-before");
      const startOver = page.getByRole("button", { name: "Start Over", exact: true });
      result.startOverVisible = await startOver.isVisible().catch(() => false);
      if (result.startOverVisible) await startOver.click();
      const startOverAfter = await snapshot(page, "S2-start-over-after");
      const previousSupported = await page.evaluate(() => {
        const action = window.__ajnMediaSessionActions?.previoustrack;
        if (typeof action !== "function") return false;
        action({});
        return true;
      });
      result.mediaSessionPreviousSupported = previousSupported;
      await sleep(2_000);
      const previousAfter = await snapshot(page, "S2-previous-track-after");
      const seekableStart = (startBefore.seekable || [])[0]?.[0] ?? null;
      const seekableEnd = (startBefore.seekable || []).at(-1)?.[1] ?? null;
      const startOverMovedToStart = result.startOverVisible && seekableStart !== null && (startOverAfter.currentTime <= seekableStart + 10 || startOverAfter.currentTime <= 10);
      const previousMovedToStart = previousSupported && seekableStart !== null && (previousAfter.currentTime <= seekableStart + 10 || previousAfter.currentTime <= 10);
      result.scenarios.S2 = {
        startBefore,
        startOverAfter,
        previousAfter,
        seekableStart,
        seekableEnd,
        startOverVisible: result.startOverVisible,
        previousSupported,
        startOverMovedToStart,
        previousMovedToStart,
      };

      await page.close();
      const control = await startSession();
      page = control.page;
      const controlStart = Date.now();
      const startSnapshot = await snapshot(page, "S3-control-start");
      await sampleFor(page, result.samples, "S3-control", CONTROL_MS);
      const controlEnd = Date.now();
      const controlSamples = result.samples.filter((sample) => sample.phase === "S3-control");
      const restarts = [];
      for (let i = 1; i < controlSamples.length; i++) {
        if (Number(controlSamples[i].currentTime) + 2 < Number(controlSamples[i - 1].currentTime)) {
          restarts.push({ at: controlSamples[i].at, from: controlSamples[i - 1].currentTime, to: controlSamples[i].currentTime });
        }
      }
      const controlEvents = await page.evaluate(() => ({ hls: window.__ajnHlsEvents || [], media: window.__ajnMediaEvents || [], loads: window.__ajnMediaLoadCalls || [] }));
      const unforcedReconnects = controlEvents.hls.filter((event) => event.event === "ERROR" && (event.fatal === true || /manifestLoadError|bufferAppendError|mediaError/i.test(`${event.details} ${event.type}`)));
      result.scenarios.S3 = {
        started: control.progress.ok,
        startSnapshot,
        startedAt: controlStart,
        endedAt: controlEnd,
        elapsedSeconds: Number(((controlEnd - controlStart) / 1000).toFixed(1)),
        complete10Minutes: controlEnd - controlStart >= CONTROL_MS,
        restartCount: restarts.length,
        restarts,
        unforcedHlsErrorCount: unforcedReconnects.length,
        hlsEvents: controlEvents.hls,
        mediaEvents: controlEvents.media,
        mediaLoadCalls: controlEvents.loads,
      };
    }

    const s1 = result.scenarios.S1 || {};
    const s2 = result.scenarios.S2 || {};
    const suspectA = Boolean(s1.reconnectStatus && s1.mediaLoadDuringStall && (s1.hlsErrorSummary?.length || s1.backwardJump));
    const suspectB = Boolean(s2.startOverMovedToStart || s2.previousMovedToStart);
    result.suspects = { A: suspectA ? "CONFIRMED" : first.progress.ok ? "NOT_CONFIRMED" : "INCONCLUSIVE", B: suspectB ? "CONFIRMED" : first.progress.ok ? "NOT_CONFIRMED" : "INCONCLUSIVE" };
    result.blockedSegments = blockedSegments;
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(REPORT_DIR, "BEFORE.json"), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(REPORT_DIR, "BEFORE.md"), renderMarkdown(result));
    console.log(JSON.stringify({
      channel: result.channel,
    scenarioStatus: Object.fromEntries(Object.entries(result.scenarios).map(([key, value]) => [key, value.started === false ? "NO_PLAYBACK" : "RECORDED"])),
      suspects: result.suspects,
      blockedSegmentRequests: result.segmentBlockCount,
      s1RecoveredWithin30s: result.scenarios.S1?.recoveredWithin30s ?? null,
      startOverVisible: result.startOverVisible,
      mediaSessionPreviousSupported: result.mediaSessionPreviousSupported,
      controlRestartCount: result.scenarios.S3?.restartCount ?? null,
      reports: [path.join(REPORT_DIR, "BEFORE.json"), path.join(REPORT_DIR, "BEFORE.md")],
    }, null, 2));
  } finally {
    blockSegments = false;
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function renderMarkdown(result) {
  const s1 = result.scenarios.S1 || {};
  const s2 = result.scenarios.S2 || {};
  const s3 = result.scenarios.S3 || {};
  const timeline = result.samples
    .filter((sample) => sample.phase !== "requestfailed")
    .map((sample) => `| ${new Date(sample.at).toISOString()} | ${sample.phase} | ${Number(sample.currentTime || 0).toFixed(2)} | ${sample.readyState ?? "—"} | ${sample.networkState ?? "—"} | ${sample.status || "—"} |`)
    .join("\n");
  return [
    "# Live HLS probe — BEFORE",
    "",
    `Generated: ${result.createdAt}`,
    `App: ${result.baseUrl}`,
    `Browser: ${result.browser}`,
    `Channel: ${result.channel.channelName} (${result.channel.channelId}); program entry: ${result.channel.programIndex}`,
    `Schedule source host: ${result.channel.sourceHost}`,
    "",
    "## Scenario results",
    "",
    "| Scenario | Result | Evidence |",
    "|---|---|---|",
    `| S1 forced stall | ${s1.recoveredWithin30s ? "recovered" : s1.started ? "no recovery within 30 s" : "inconclusive: no initial playback"} | blocked segment requests: ${s1.blockedRequestCount ?? 0}; stall ${result.constants.stallSeconds}s; reconnect status: ${Boolean(s1.reconnectStatus)}; media.load during stall: ${Boolean(s1.mediaLoadDuringStall)}; backward jump after block start: ${Boolean(s1.backwardJump)} |`,
    `| S2 Start Over / previous-track | ${s2.startOverMovedToStart || s2.previousMovedToStart ? "jumped to seekable start" : "no start jump observed"} | Start Over visible: ${Boolean(s2.startOverVisible)}; previous-track supported: ${Boolean(s2.previousSupported)}; seekable start/end: ${s2.seekableStart ?? "—"} / ${s2.seekableEnd ?? "—"} |`,
    `| S3 control | ${s3.complete10Minutes ? `${s3.restartCount ?? 0} unforced time jumps` : "incomplete"} | elapsed: ${s3.elapsedSeconds ?? 0}s; HLS fatal/error count: ${s3.unforcedHlsErrorCount ?? "—"} |`,
    "",
    "## Suspects",
    "",
    `- A (stall watchdog restarts HLS incorrectly): ${result.suspects?.A ?? "INCONCLUSIVE"}`,
    `- B (Start Over / previous-track seeks live HLS to buffer start): ${result.suspects?.B ?? "INCONCLUSIVE"}`,
    "",
    "## Two-second timeline",
    "",
    "| UTC time | Phase | currentTime | readyState | networkState | App status |",
    "|---|---|---:|---:|---:|---|",
    timeline,
    "",
    "## Event details",
    "",
    `- Segment blocks: ${result.segmentBlockCount}; only Pluto/Siloh media-segment requests were blocked.`,
    `- Console errors: ${result.consoleErrors.length}; page errors: ${result.pageErrors.length}.`,
    "- This report records playback state and HLS/media event metadata only; it does not record stream or caption text.",
    "",
  ].join("\n");
}

run().catch((error) => {
  console.error(`[live-hls-probe] ${error.stack || error.message || String(error)}`);
  process.exitCode = 1;
});
