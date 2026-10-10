// First-time-user playback check. Run on YOUR computer against the live app:
//   npm i -D playwright            (once; uses your installed Google Chrome, no browser download)
//   node tools/first-run-check.mjs --url https://<your-app>            (desktop)
//   node tools/first-run-check.mjs --url https://<your-app> --phone    (Galaxy S25-sized, touch)
// Options: --soak 300 (seconds of buffering watch, default 120)  --channel chrome|msedge|"" (""=bundled Chromium: cannot play H.264!)
//          --headless  --out report.json  --selftest-webm /path.webm (harness self-test only: serves a local file for /api/archive/proxy)
// Fresh profile every run, DEFAULT autoplay policy (no flags). Nothing is clicked except what a first-time user would click.
import { chromium } from "playwright";
import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith("--") || i + 1 >= process.argv.length ? true : process.argv[i + 1]); };
const URL_ = String(arg("url", "http://localhost:3000")).replace(/\/$/, "");
const PHONE = !!arg("phone", false), SOAK = Number(arg("soak", 120)), OUT = String(arg("out", `first-run-report-${PHONE ? "phone" : "desktop"}.json`));
const CHANNEL = arg("channel", "chrome"), HEADLESS = !!arg("headless", false), SELF = arg("selftest-webm", null);
const R = []; const rec = (id, pass, evidence) => { R.push({ id, result: pass === null ? "NOT TESTED" : pass ? "PASS" : "FAIL", evidence }); console.log(`${pass === null ? "SKIP" : pass ? "PASS" : "FAIL"}  ${id}  ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: HEADLESS, ...(CHANNEL ? { channel: String(CHANNEL) } : {}) });
const ctx = await browser.newContext(PHONE
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" }
  : { viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.__p = { ev: [], t0: performance.now() };
  const L = (e, el) => window.__p.ev.push({ e, t: Math.round(performance.now() - window.__p.t0), ct: +el.currentTime.toFixed(2), rs: el.readyState, paused: el.paused, muted: el.muted, src: (el.currentSrc || "").slice(-70) });
  new MutationObserver(() => document.querySelectorAll("video,audio").forEach((el) => { if (el.__p) return; el.__p = 1;
    ["loadstart", "loadedmetadata", "canplay", "playing", "waiting", "stalled", "pause", "ended", "error", "seeked"].forEach((n) => el.addEventListener(n, () => L(n, el))); })).observe(document, { subtree: true, childList: true });
});
const page = await ctx.newPage();
const proxy = [], bad = [], errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text()}`.slice(0, 200)); });
page.on("response", async (r) => {
  const u = r.url(); const h = r.headers(); const st = r.status();
  if (u.includes("/api/archive/proxy") && /^(video|audio)\//.test(h["content-type"] || "")) proxy.push({ status: st, range: r.request().headers()["range"] || null, contentRange: h["content-range"] || null, length: Number(h["content-length"] || -1), url: u.slice(-90) });
  if (st >= 400 || (st >= 300 && st < 400 && st !== 304)) bad.push(`${st} ${u.slice(0, 120)}`);
});
if (SELF) { const buf = fs.readFileSync(String(SELF)); await page.route("**/api/archive/proxy*", (route) => { if (/\.(jpe?g|png|webp)(%3F|$|\?)/i.test(decodeURIComponent(route.request().url()))) return route.continue(); const rng = route.request().headers()["range"]; const h = { "content-type": "video/webm", "accept-ranges": "bytes" };
  if (rng) { const m = /bytes=(\d+)-(\d*)/.exec(rng); const s = +m[1], e = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1); return route.fulfill({ status: 206, headers: { ...h, "content-range": `bytes ${s}-${e}/${buf.length}` }, body: buf.subarray(s, e + 1) }); }
  return route.fulfill({ status: 200, headers: h, body: buf }); }); }
const media = () => page.evaluate(() => { const el = document.querySelector("video") || document.querySelector("audio"); return el ? { tag: el.tagName, paused: el.paused, muted: el.muted, vol: el.volume, ct: +el.currentTime.toFixed(2), d: el.duration, rs: el.readyState, err: el.error && el.error.code, src: (el.currentSrc || "").slice(-80) } : null; });

// ---- S1 first video, no Play press ----
await page.goto(`${URL_}/#tv-guide`); await sleep(2500);
const play = page.locator("[data-play-live]:not([disabled])").first();
if (!(await play.count())) { rec("S1 first video autoplay", false, "no playable item found in the Guide (selector [data-play-live])"); }
else {
  const t0 = Date.now(); await play.click();
  let m = null; const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { m = await media(); if (m && !m.paused && m.ct > 0.3 && m.rs >= 3) break; await sleep(200); }
  const ms = Date.now() - t0; const ok = !!m && !m.paused && m.ct > 0.3;
  const blockedBtn = await page.locator("[data-testid=autoplay-blocked]").count();
  rec("S1 first video starts by itself (no Play press)", ok && blockedBtn === 0, { msClickToPlaying: ms, state: m, playButtonPromptShown: blockedBtn > 0 });
  rec("S1b starts muted (expected) / target <= 5000 ms", ok && m.muted === true && ms <= 5000, { muted: m?.muted, ms });
  await page.screenshot({ path: `first-run-S1-${PHONE ? "phone" : "desktop"}.png` });
  // ---- S2 one unmute ----
  const unmute = page.locator("[aria-label='Unmute']").first();
  if (!(await unmute.count())) rec("S2 one Unmute click", false, "no Unmute control found");
  else { await unmute.click(); await sleep(1500); const a = await media();
    rec("S2 exactly one Unmute click gives sound, playback continues", !!a && a.muted === false && a.vol > 0 && !a.paused && a.ct >= (m?.ct ?? 0), { clicks: 1, after: a }); }
  // ---- S3 auto-advance ----
  const before = await media();
  if (before && Number.isFinite(before.d) && before.d > 10) {
    await page.evaluate(() => { const v = document.querySelector("video") || document.querySelector("audio"); v.currentTime = Math.max(0, v.duration - 3); });
    let after = null; const dl = Date.now() + 30000;
    while (Date.now() < dl) { await sleep(500); after = await media(); if (after && after.src !== before.src && !after.paused && after.ct > 0.3) break; }
    const prompt = await page.locator("[data-testid=autoplay-blocked]").count();
    rec("S3 next item starts by itself, with sound, no click", !!after && after.src !== before.src && !after.paused && after.muted === false && prompt === 0, { before: before.src, after, playPromptShown: prompt > 0 });
  } else rec("S3 auto-advance", null, "current item is live/unknown duration; pick a finite item and rerun");
  // ---- S5 buffering watch ----
  const mark = (await page.evaluate(() => window.__p.ev.length));
  await sleep(SOAK * 1000);
  const ev = await page.evaluate((from) => window.__p.ev.slice(from), mark);
  const waits = ev.filter((e) => e.e === "waiting" || e.e === "stalled");
  let longest = 0; for (const w of waits) { const nxt = ev.find((e) => e.e === "playing" && e.t > w.t); longest = Math.max(longest, nxt ? nxt.t - w.t : SOAK * 1000); }
  const fin = await media();
  rec(`S5 buffering over ${SOAK}s (<=3 waits/5min, none > 5 s)`, waits.length <= Math.ceil(3 * SOAK / 300) && longest <= 5000 && !!fin && !fin.paused, { waitingOrStalled: waits.length, longestMs: longest, errorEvents: ev.filter((e) => e.e === "error").length, finalState: fin });
  // ---- S6 seek ----
  if (fin && Number.isFinite(fin.d) && fin.d > 30) { const res = [];
    for (const f of [0.5, 0.2, 0.7]) { const t1 = Date.now(); await page.evaluate((x) => { const v = document.querySelector("video") || document.querySelector("audio"); v.currentTime = v.duration * x; }, f);
      let ok = false; while (Date.now() - t1 < 8000) { const s = await media(); if (s && !s.paused && s.rs >= 3) { ok = true; break; } await sleep(150); } res.push({ to: f, ms: Date.now() - t1, ok }); }
    rec("S6 three seeks each resume <= 5 s", res.every((r) => r.ok && r.ms <= 5000), res);
  } else rec("S6 seek", null, "item has no finite duration");
  // ---- S10 reload ----
  await page.reload(); await sleep(4000); const r10 = await media();
  rec("S10 reload (informational): a video is not restored (pick again); an AUDIO item is restored paused with 'tap Play'; anything that autoplays must start muted", r10 === null || r10.muted === true || r10.paused === true, r10 ? { state: r10 } : "nothing playing after reload (expected for video)");
}
// ---- S7 transport ----
const MAX = 8 * 1024 * 1024; const badT = proxy.filter((p) => p.status !== 206 || !p.contentRange || (p.length >= 0 && p.length > MAX));
rec("S7 every proxied media response is 206 + Content-Range + <= 8 MiB", proxy.length > 0 && badT.length === 0, { responses: proxy.length, violations: badT.slice(0, 5), sample: proxy.slice(0, 3) });
rec("S9 no uncaught page errors", errs.length === 0, errs.slice(0, 8));
rec("S9b non-2xx/206 requests (informational)", true, bad.slice(0, 15));
rec("S8 failure honesty / S4 audio channel", null, "not automated (needs a known-bad item / audio channel selection): test by hand and note the UI message");
const events = await page.evaluate(() => window.__p.ev.slice(0, 60)).catch(() => []);
fs.writeFileSync(OUT, JSON.stringify({ url: URL_, phone: PHONE, channel: CHANNEL, at: new Date().toISOString(), results: R, firstEvents: events, proxy: proxy.slice(0, 80) }, null, 2));
console.log(`\nReport: ${OUT}  (${R.filter((r) => r.result === "FAIL").length} FAIL, ${R.filter((r) => r.result === "PASS").length} PASS, ${R.filter((r) => r.result === "NOT TESTED").length} not tested)`);
await browser.close();
process.exit(R.some((r) => r.result === "FAIL") ? 1 : 0);
