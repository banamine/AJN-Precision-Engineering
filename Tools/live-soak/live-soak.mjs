// AJN live soak / stall investigator. Run on YOUR computer against the live app (see README.md).
//   node tools/live-soak/live-soak.mjs --url https://<your-app> [--scenario all|mix|soak|random|switch|net] [--minutes 20] [--iterations 10]
// Options: --channel chrome|msedge|"" (default chrome: bundled Chromium cannot play H.264)  --headless  --guide tv-guide  --seed 7
//          --tab classic-tv  (open that guide tab first)  --match "Wanted"  (play the first channel whose Play button label matches)  --switches 12  --selftest-webm file.webm [--selftest-slice 1048576] [--selftest-delay-ms 4000]   (harness self-test: serves a local file through a fake /api/archive/proxy)
// Nothing is faked: every number comes from the <video>/<audio> element and from the real /api/archive/proxy responses.
import { chromium } from "playwright";
import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i + 1]; return v === undefined || v.startsWith("--") ? true : v; };
const URL_ = String(arg("url", "http://localhost:3000")).replace(/\/$/, "");
const DW = Number(arg("dwell-scale", 1)), SW = Number(arg("switches", 12)), SCEN = String(arg("scenario", "all")), MIN = Number(arg("minutes", 20)), ITER = Number(arg("iterations", 10));
const MATCH = arg("match", null), TAB = arg("tab", null), GUIDE = String(arg("guide", "tv-guide")), CHANNEL = arg("channel", "chrome"), HEADLESS = !!arg("headless", false);
const SELF = arg("selftest-webm", null), SLICE = Number(arg("selftest-slice", 8 * 1024 * 1024)), DELAY = Number(arg("selftest-delay-ms", 0));
let seed = Number(arg("seed", Date.now() % 100000)); const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const OUT = String(arg("out", `live-soak-report-${stamp}`));
const T0 = Date.now(); const now = () => Date.now() - T0;

const browser = await chromium.launch({ headless: HEADLESS, ...(CHANNEL && CHANNEL !== true ? { channel: String(CHANNEL) } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const log = (...a) => console.log(`[${(now() / 1000).toFixed(1).padStart(7)}s]`, ...a);

// ---------- evidence collectors ----------
const samples = [];   // media element state every 500 ms
const events = [];    // media element events
const reqs = new Map(); // proxy requests
const netLog = [];    // harness-imposed network changes (so they are not blamed on the server)
const errors = [];
page.on("pageerror", (e) => errors.push({ t: now(), e: String(e).slice(0, 200) }));
page.on("console", (m) => { if (m.type() === "error") errors.push({ t: now(), e: m.text().slice(0, 200) }); });
const isMediaReq = (u) => u.includes("/api/archive/proxy") && !/\.(jpe?g|png|webp|gif)(%3F|$|&)/i.test(decodeURIComponent(u)) && !/__ia_thumb/.test(u);
page.on("request", (r) => { if (!isMediaReq(r.url())) return; reqs.set(r, { id: reqs.size + 1, t0: now(), range: r.headers()["range"] || null, url: decodeURIComponent(r.url()).replace(/^.*path=/, "").slice(-60) }); });
page.on("response", (r) => { const q = reqs.get(r.request()); if (!q) return; const h = r.headers(); q.ttfbMs = now() - q.t0; q.status = r.status(); q.contentRange = h["content-range"] || null; q.serverTiming = h["server-timing"] || null; q.proxyId = h["x-proxy-request-id"] || null; q.type = h["content-type"] || null; });
page.on("requestfinished", async (r) => { const q = reqs.get(r); if (!q) return; q.doneMs = now() - q.t0; try { const s = await r.sizes(); q.bytes = s.responseBodySize; } catch {} });
page.on("requestfailed", (r) => { const q = reqs.get(r); if (!q) return; q.failed = r.failure()?.errorText || "failed"; q.doneMs = now() - q.t0; });

await ctx.addInitScript(() => {
  window.__ev = [];
  const L = (e, el) => { const b = el.buffered; let ahead = 0; for (let i = 0; i < b.length; i++) if (el.currentTime >= b.start(i) - 0.1 && el.currentTime <= b.end(i) + 0.1) ahead = b.end(i) - el.currentTime;
    window.__ev.push({ e, ct: +el.currentTime.toFixed(2), rs: el.readyState, ns: el.networkState, ahead: +ahead.toFixed(1), paused: el.paused, src: (el.currentSrc || "").slice(-60) }); };
  new MutationObserver(() => document.querySelectorAll("video,audio").forEach((el) => { if (el.__w) return; el.__w = 1;
    ["loadstart", "loadedmetadata", "canplay", "playing", "waiting", "stalled", "suspend", "pause", "seeking", "seeked", "ended", "error", "emptied", "abort"].forEach((n) => el.addEventListener(n, () => L(n, el))); })).observe(document, { subtree: true, childList: true });
});
const snap = () => page.evaluate(() => {
  const els = [...document.querySelectorAll("video,audio")]; const el = els.find((x) => !x.paused) || els[0];
  const ev = window.__ev.splice(0);
  if (!el) return { n: 0, ev };
  const b = el.buffered; let ahead = 0, ranges = []; for (let i = 0; i < b.length; i++) { ranges.push([+b.start(i).toFixed(1), +b.end(i).toFixed(1)]); if (el.currentTime >= b.start(i) - 0.1 && el.currentTime <= b.end(i) + 0.1) ahead = b.end(i) - el.currentTime; }
  const txt = (document.body.innerText.match(/^(Network stalled|Buffering|Reconnecting|Playing|Loading|Failed to load|Unavailable|Ready)[^\n]*/m) || [""])[0];
  return { n: els.length, tag: el.tagName, ct: +el.currentTime.toFixed(2), d: Number.isFinite(el.duration) ? +el.duration.toFixed(1) : null, paused: el.paused, rs: el.readyState, ns: el.networkState, ahead: +ahead.toFixed(1), ranges, status: txt,
    retry: !!document.querySelector("[data-testid=playback-retry]"), src: (el.currentSrc || "").slice(-70), ev };
}).catch(() => null);
let sampler = true;
(async () => { while (sampler) { const s = await snap(); if (s) { for (const e of s.ev) events.push({ t: now(), ...e }); delete s.ev; samples.push({ t: now(), ...s }); } await sleep(500); } })();

// ---------- optional self-test upstream ----------
if (SELF) { const buf = fs.readFileSync(String(SELF)); let n = 0;
  await page.route("**/api/archive/proxy*", async (route) => { const u = decodeURIComponent(route.request().url()); if (/\.(jpe?g|png|webp)$|__ia_thumb/i.test(u)) return route.continue();
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] || ""); const s = m ? +m[1] : 0; const e = Math.min(buf.length - 1, s + SLICE - 1, m && m[2] ? +m[2] : Infinity);
    if (DELAY && s > 0) await sleep(DELAY);   // slow every slice after the first, like a slow upstream round trip
    n++; return route.fulfill({ status: 206, headers: { "content-type": "video/webm", "accept-ranges": "bytes", "content-range": `bytes ${s}-${e}/${buf.length}`, "server-timing": `upstream;dur=${DELAY}` }, body: buf.subarray(s, e + 1) }); }); }

// ---------- helpers ----------
const emulate = async (label, c) => { netLog.push({ t: now(), label }); log("NETWORK:", label); await cdp.send("Network.emulateNetworkConditions", c); };
const online = () => emulate("online (unthrottled)", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const goGuide = async (hash = GUIDE) => { await page.goto(`${URL_}/#${hash}`); await sleep(2500);
  if (TAB && hash === GUIDE) { await page.locator(`#guide-tab-${TAB}`).click({ timeout: 8000 }).catch(() => log(`guide tab "${TAB}" not found`)); await sleep(3500); }
  // The Classic schedule is a 20-40 MB JSON: wait for the first Play button instead of assuming 6 s is enough.
  const t0 = Date.now(); await page.locator("[data-play-live]").first().waitFor({ timeout: 90_000 }).then(() => log(`guide rendered after ${((Date.now() - t0) / 1000 + 6).toFixed(1)}s`)).catch(() => log("guide did not render a Play button within 96 s")); };
const playButtons = () => page.locator("[data-play-live]:not([disabled])");
async function playRandom(why) {
  const b = playButtons(); const n = await b.count(); if (!n) { log("no [data-play-live] buttons on this page"); return null; }
  let i = Math.floor(rnd() * n);
  const findIdx = () => b.evaluateAll((els, re) => { const rx = new RegExp(re, "i"); return els.findIndex((el) => rx.test(el.getAttribute("aria-label") || el.title || "")); }, String(MATCH));
  if (MATCH && (await findIdx()) < 0) {   // the guide shows a page of rows at a time: press "Load more" until the channel appears
    for (let k = 0; k < 40; k++) { const more = page.locator("button:has-text('Load more')"); if (!(await more.count())) break; await more.first().click({ timeout: 4000 }).catch(() => {}); await sleep(400); if ((await findIdx()) >= 0) break; } }
  if (MATCH) { const idx = await b.evaluateAll((els, re) => { const rx = new RegExp(re, "i"); return els.findIndex((el) => rx.test(el.getAttribute("aria-label") || el.title || "")); }, String(MATCH));
    if (idx >= 0) i = idx; else log(`--match "${MATCH}" found no Play button among ${n} on this page; playing a random one instead (say so in your report)`); }
  const t = now(); await b.nth(i).scrollIntoViewIfNeeded().catch(() => {}); await b.nth(i).click({ timeout: 8000 }).catch((e) => log("click failed", String(e).split("\n")[0]));
  const ok = await waitFor((s) => s && !s.paused && s.ct > 0.5 && s.rs >= 3, 40000);
  const s = samples.at(-1); log(`${why}: button #${i}/${n} ->`, ok ? `playing after ${((now() - t) / 1000).toFixed(1)}s` : "DID NOT START in 40s", s?.src); return { i, n, startMs: ok ? now() - t : null, src: s?.src };
}
async function waitFor(pred, ms) { const end = now() + ms; while (now() < end) { if (pred(samples.at(-1))) return true; await sleep(250); } return false; }

// ---------- scenarios ----------
const results = {};
async function scenSoak() {
  log(`SOAK: one item for ${MIN} min, no interaction`); await goGuide(); const p = await playRandom("soak start"); results.soak = { start: p };
  const end = now() + MIN * 60_000; let lastPrint = 0;
  while (now() < end) { await sleep(5000); const s = samples.at(-1); if (now() - lastPrint > 60_000) { lastPrint = now(); log(`soak ct=${s?.ct} ahead=${s?.ahead}s status="${s?.status}" proxyReqs=${reqs.size}`); } }
}
async function scenRandom() {
  log(`RANDOM: ${ITER} random items, random seeks/pauses`); results.random = [];
  for (let k = 0; k < ITER; k++) {
    await goGuide(k % 3 === 2 && GUIDE === "tv-guide" ? "radio" : GUIDE); const p = await playRandom(`random ${k + 1}`); if (!p?.startMs) { results.random.push({ ...p, note: "did not start" }); continue; }
    await sleep(8000 + rnd() * 8000);
    for (let j = 0; j < 3; j++) {
      const frac = 0.05 + rnd() * 0.9; const before = now();
      await page.evaluate((f) => { const v = [...document.querySelectorAll("video,audio")].find((x) => !x.paused) || document.querySelector("video,audio"); if (v && v.duration) v.currentTime = v.duration * f; }, frac);
      const ok = await waitFor((s) => s && !s.paused && s.rs >= 3 && s.ahead > 1, 45000);
      results.random.push({ item: k + 1, src: p.src, seekFrac: +frac.toFixed(2), resumeSec: ok ? +((now() - before) / 1000).toFixed(1) : null, note: ok ? "" : "NO RESUME in 45s" }); log(`  seek ${frac.toFixed(2)} -> ${ok ? ((now() - before) / 1000).toFixed(1) + "s" : "NO RESUME"}`);
      await sleep(4000 + rnd() * 6000);
    }
    await page.evaluate(() => { const v = document.querySelector("video,audio"); v?.pause(); }); await sleep(3000); await page.evaluate(() => document.querySelector("video,audio")?.play().catch(() => {})); await sleep(4000);
  }
}
const actionLog = [];   // what the harness did and when, so every stall can be tied to the action before it
const act = (label, extra = {}) => { actionLog.push({ t: now(), label, ...extra }); log(`ACTION: ${label}`); };
async function viewGuide(tab) {   // switch guide tab WITHOUT reloading the app (the player keeps running, like a real user browsing)
  await page.evaluate((h) => { if (location.hash !== `#${h}`) location.hash = h; }, GUIDE); await sleep(1500);
  if (tab) { await page.locator(`#guide-tab-${tab}`).click({ timeout: 8000 }).catch(() => log(`guide tab "${tab}" not found`)); await sleep(3000); } }
async function scenMix() {
  log(`MIX: ${MIN} min of realistic use: next episodes, other shows, audio, seeks, pauses`); results.mix = { actions: [] };
  await goGuide(); const first = await playRandom("mix start"); act("start", { src: first?.src }); await sleep((60_000 + rnd() * 60_000) * DW);
  const end = now() + MIN * 60_000; const kinds = [["next-episode", 25], ["other-video-show", 25], ["audio-show", 25], ["seek", 15], ["pause-resume", 10]];
  while (now() < end) {
    let r = rnd() * 100, kind = kinds[0][0]; for (const [k, w] of kinds) { if (r < w) { kind = k; break; } r -= w; }
    if (kind === "next-episode") {   // jump to the last 3 s: the real end-of-program handoff to the next episode
      const ok = await page.evaluate(() => { const v = [...document.querySelectorAll("video,audio")].find((x) => !x.paused) || document.querySelector("video,audio"); if (!v || !Number.isFinite(v.duration) || v.duration < 30) return false; v.currentTime = v.duration - 3; return true; });
      act("next-episode (seek to last 3 s)", { ok }); if (ok) { const before = samples.at(-1)?.src; await waitFor((x) => x && x.src && x.src !== before && !x.paused && x.rs >= 3, 60000); act("  next episode " + (samples.at(-1)?.src !== before ? "started" : "DID NOT START in 60s"), { src: samples.at(-1)?.src }); } }
    else if (kind === "other-video-show") { await viewGuide(TAB || "classic-tv"); const p = await playRandom("other video show"); act("other-video-show", { startMs: p?.startMs, src: p?.src }); }
    else if (kind === "audio-show") { await viewGuide("audio-podcasts"); const p = await playRandom("audio show"); act("audio-show", { startMs: p?.startMs, src: p?.src }); }
    else if (kind === "seek") { const f = 0.05 + rnd() * 0.9; await page.evaluate((x) => { const v = [...document.querySelectorAll("video,audio")].find((y) => !y.paused) || document.querySelector("video,audio"); if (v && v.duration) v.currentTime = v.duration * x; }, f); const t = now(); const ok = await waitFor((x) => x && !x.paused && x.rs >= 3 && x.ahead > 1, 45000); act(`seek ${f.toFixed(2)}`, { resumeSec: ok ? +((now() - t) / 1000).toFixed(1) : null }); }
    else { await page.evaluate(() => document.querySelector("video,audio")?.pause()); const hold = 10_000 + rnd() * 20_000; act(`pause ${(hold / 1000).toFixed(0)}s`); await sleep(hold); await page.evaluate(() => document.querySelector("video,audio")?.play().catch(() => {})); const t = now(); const ok = await waitFor((x) => x && !x.paused && x.rs >= 3, 30000); act("  resume after pause", { resumeSec: ok ? +((now() - t) / 1000).toFixed(1) : null }); }
    await sleep((45_000 + rnd() * 150_000) * DW);   // dwell: let it play
  }
  results.mix.actions = actionLog;
}
async function scenSwitch() {
  log(`SWITCH: ${SW} fast switches between items`); await goGuide(); results.switch = { switches: 0, mediaElementsMax: 0, startMs: [] };
  for (let k = 0; k < SW; k++) { const p = await playRandom(`switch ${k + 1}`); results.switch.switches++; if (p?.startMs) results.switch.startMs.push(p.startMs); const s = samples.at(-1); results.switch.mediaElementsMax = Math.max(results.switch.mediaElementsMax, s?.n || 0); await sleep(2000 + rnd() * 4000);
    if (k % 5 === 4) { await goGuide(); } }
  const playing = await page.evaluate(() => [...document.querySelectorAll("video,audio")].filter((x) => !x.paused).length); results.switch.playingAtEnd = playing;
}
async function scenNet() {
  log("NET: buffering vs network transitions"); await goGuide(); const p = await playRandom("net start"); results.net = { start: p, steps: [] };
  if (!p?.startMs) return; await sleep(15000);
  const step = async (label, cond, holdMs, after = 40000) => {
    const ct0 = samples.at(-1)?.ct; await emulate(label, cond); await sleep(holdMs); const stalled = samples.at(-1); await online(); const t = now();
    const ok = await waitFor((s) => s && !s.paused && s.rs >= 3 && s.ct > (stalled?.ct ?? 0) + 1.5, after); const s = samples.at(-1);
    results.net.steps.push({ label, heldSec: holdMs / 1000, statusDuring: stalled?.status, aheadWhenRestored: stalled?.ahead, retryShownDuring: stalled?.retry, resumedBySelf: ok, resumeSecAfterRestore: ok ? +((now() - t) / 1000).toFixed(1) : null, ctBefore: ct0, ctAfter: s?.ct, statusAfter: s?.status });
    log(`  ${label}: ${ok ? "resumed by itself " + ((now() - t) / 1000).toFixed(1) + "s after restore" : "DID NOT RESUME"}; status during="${stalled?.status}" retryShown=${stalled?.retry}`);
    if (!ok && s?.retry) { log("  clicking Retry"); const tr = now(); await page.locator("[data-testid=playback-retry]").click().catch(() => {}); const ok2 = await waitFor((x) => x && !x.paused && x.rs >= 3, 40000); results.net.steps.at(-1).retryClicked = true; results.net.steps.at(-1).retryResumed = ok2; results.net.steps.at(-1).retryResumeSec = ok2 ? +((now() - tr) / 1000).toFixed(1) : null; }
    await sleep(8000); };
  await step("offline 4s (shorter than buffer)", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, 4000);
  await step("offline 25s", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, 25000);
  await step("slow 3G-like 50 KB/s for 40s", { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 }, 40000);
  await step("offline 60s (longer than the 45s watchdog)", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, 60000, 60000);
}

if (SELF && (SCEN === "net" || SCEN === "all")) log("NOTE: --selftest-webm serves through a local route; network emulation does not apply to it, so the net scenario is only meaningful against the real URL.");
try {
  await online(); await page.goto(`${URL_}/`); await sleep(1500);
  if (SCEN === "all" || SCEN === "random") await scenRandom();
  if (SCEN === "all" || SCEN === "switch") await scenSwitch();
  if (SCEN === "all" || SCEN === "net") await scenNet();
  if (SCEN === "all" || SCEN === "mix") await scenMix();
  if (SCEN === "soak") await scenSoak();
} catch (e) { log("HARNESS STOPPED:", String(e).split("\n")[0]); results.harnessError = String(e).split("\n")[0]; }
sampler = false; await sleep(700);

// ---------- stall analysis ----------
const reqList = [...reqs.values()];
const stalls = []; let cur = null;
for (const s of samples) {
  const bad = s.n > 0 && !s.paused && s.rs < 3 && s.ct > 0.3;
  if (bad && !cur) cur = { start: s.t, ct: s.ct, aheadAtStart: samples[samples.indexOf(s) - 1]?.ahead ?? null, status: new Set(), retry: false };
  if (cur) { if (s.status) cur.status.add(s.status); cur.retry ||= s.retry; }
  if (!bad && cur) { cur.end = s.t; stalls.push(cur); cur = null; }
}
if (cur) { cur.end = samples.at(-1).t; cur.unresolved = true; stalls.push(cur); }
const harnessWindow = (t) => netLog.some((n, i) => t >= n.t && t <= (netLog[i + 1]?.t ?? t) && !/^online/.test(n.label));
for (const st of stalls) {
  const la = [...actionLog].reverse().find((a) => a.t <= st.start); st.lastAction = la ? `${la.label} (${((st.start - la.t) / 1000).toFixed(0)} s earlier)` : "-";
  st.durationSec = +((st.end - st.start) / 1000).toFixed(1); st.status = [...st.status];
  const near = reqList.filter((q) => q.t0 <= st.end && (q.t0 + (q.doneMs ?? 1e9)) >= st.start - 3000);   // requests alive during/just before the stall
  st.requests = near.map((q) => ({ id: q.id, range: q.range, startedBeforeStallSec: +((st.start - q.t0) / 1000).toFixed(1), ttfbMs: q.ttfbMs ?? null, doneMs: q.doneMs ?? null, status: q.status ?? null, failed: q.failed || null, bytes: q.bytes ?? null, serverTiming: q.serverTiming }));
  const slow = near.find((q) => !q.failed && (q.ttfbMs ?? 0) > 2500);   // slow first byte = server/upstream wait
  const broke = near.find((q) => q.failed && !/ABORTED/i.test(q.failed));  // ERR_ABORTED = the browser itself replaced the request (normal on seek), not a cause
  const late = slow || broke;
  st.cause = harnessWindow(st.start) ? "harness-imposed network change (expected)"
    : late ? (late.failed ? `proxy request #${late.id} failed (${late.failed})` : `proxy request #${late.id} (${late.range}) took ${late.ttfbMs} ms to first byte${late.serverTiming ? "; server-timing: " + late.serverTiming : ""}`)
    : near.length === 0 || near.every((q) => q.failed && /ABORTED/i.test(q.failed)) ? "NO live proxy request (only browser-cancelled ones): the browser/player was idle, not waiting on the server" : "request in flight but not slow to first byte: body transfer slower than playback (bandwidth)";
  if (la && st.start - la.t < 4000 && /^(seek|next-episode|other-video|audio-show|  resume|start)/.test(la.label)) st.cause = `right after the harness action "${la.label.trim()}" (normal re-buffering; only a problem if it is long). Detail: ${st.cause}`;
}
const proxyStats = { total: reqList.length, aborted: reqList.filter((q) => q.failed).length, non2xx: reqList.filter((q) => q.status && q.status >= 300).length,
  ttfbMs: (() => { const a = reqList.map((q) => q.ttfbMs).filter((x) => x != null).sort((x, y) => x - y); const p = (f) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : null; return { n: a.length, p50: p(0.5), p90: p(0.9), max: a.at(-1) ?? null }; })() };
const report = { url: URL_, scenario: SCEN, startedAt: new Date(T0).toISOString(), durationSec: +(now() / 1000).toFixed(0), proxyStats, stalls, results, netLog, errors: errors.slice(0, 30),
  note: "ttfbMs = browser request start -> response headers (includes Cloud Run + archive.org round trip). A stall whose cause names a proxy request is a SERVER-side wait; 'no request in flight' is a CLIENT/browser wait." };
fs.writeFileSync(`${OUT}.json`, JSON.stringify({ ...report, samples: samples.filter((_, i) => i % 4 === 0), events: events.slice(0, 600), proxyRequests: reqList.slice(0, 400) }, null, 1));
const md = [`# AJN live soak ${report.startedAt}`, `URL ${URL_} | scenario ${SCEN} | ${report.durationSec}s | proxy requests ${proxyStats.total} (aborted ${proxyStats.aborted}, non-2xx ${proxyStats.non2xx}) | TTFB p50/p90/max ms ${proxyStats.ttfbMs.p50}/${proxyStats.ttfbMs.p90}/${proxyStats.ttfbMs.max}`, "", `## Stalls (${stalls.length})`, "| at (s) | media pos | buffered ahead before | stalled for | status shown | Retry shown | last action | cause |", "|---|---|---|---|---|---|---|---|",
  ...stalls.map((s) => `| ${(s.start / 1000).toFixed(0)} | ${s.ct} | ${s.aheadAtStart}s | ${s.durationSec}s${s.unresolved ? " (never resumed)" : ""} | ${s.status.join(" / ") || "-"} | ${s.retry} | ${s.lastAction} | ${s.cause} |`), "", "## Results", "```json", JSON.stringify(results, null, 1), "```"].join("\n");
fs.writeFileSync(`${OUT}.md`, md); console.log("\n" + md.split("\n").slice(0, 12 + stalls.length).join("\n")); console.log(`\nReports: ${OUT}.md  ${OUT}.json`);
await browser.close();
