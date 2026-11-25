// Phase 3+4 UI check (diagnostics pill/drawer + overlay visualizer). Needs ffmpeg, playwright, app at AJN_TEST_URL.
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
const BASE = process.env.AJN_TEST_URL || "http://localhost:3000";
if (!fs.existsSync("/tmp/t60.webm")) execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=60:size=640x360:rate=10 -f lavfi -i sine=frequency=440:duration=60 -c:v libvpx -b:v 200k -c:a libvorbis -shortest /tmp/t60.webm");
const webm = fs.readFileSync("/tmp/t60.webm");
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const out = []; const ok = (n, c, x = "") => out.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`);
for (const [w, h] of [[1920, 1080], [768, 1024], [375, 800]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    window.__raf = 0; const r = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return r(cb); };
    window.__ac = 0; window.__mes = 0;
    const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac++; } createMediaElementSource(m) { window.__mes++; return super.createMediaElementSource(m); } };
  });
  const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", e => errs.push(String(e)));
  await pg.route("**/api/archive/proxy*", async (route) => {
    const rng = route.request().headers()["range"];
    if (rng) { const m = /bytes=(\d+)-(\d*)/.exec(rng); const s = +m[1]; const e = Math.min(webm.length - 1, m[2] ? +m[2] : webm.length - 1);
      return route.fulfill({ status: 206, headers: { "content-type": "video/webm", "accept-ranges": "bytes", "content-range": `bytes ${s}-${e}/${webm.length}` }, body: webm.subarray(s, e + 1) }); }
    return route.fulfill({ status: 200, headers: { "content-type": "video/webm", "accept-ranges": "bytes" }, body: webm });
  });
  await pg.goto(BASE + "/#tv-guide"); await pg.waitForTimeout(1500);
  await pg.evaluate(() => localStorage.clear());
  const play = pg.locator("[data-play-live]:not([disabled])").first();
  await play.click(); await pg.waitForTimeout(3000);
  const pill = pg.locator("[data-testid=analyzer-pill]"); const ov = pg.locator("[data-testid=visualizer-overlay]");
  ok(`${w}: pill present`, await pill.count() === 1);
  ok(`${w}: diagnostics drawer collapsed by default`, await pg.locator("#audio-bridge-drawer").count() === 0 && await pg.locator("#audio-bridge-panel").count() === 0);
  await pg.mouse.move(w / 2, 150);
  // unmute so the analyser receives real audio, make sure it is playing
  if (await pg.evaluate(() => document.querySelector("video").muted)) await pg.getByRole("button", { name: /^Unmute$/ }).click();
  if (await pg.evaluate(() => document.querySelector("video").paused)) await pg.getByRole("button", { name: /^Play$/ }).click();
  await pg.waitForTimeout(1500);
  ok(`${w}: pill shows Analyzer Active on real signal`, (await pill.getAttribute("data-state")) === "active", await pill.getAttribute("data-state"));
  ok(`${w}: overlay loop running while playing`, (await ov.getAttribute("data-running")) === "1");
  const painted = await ov.evaluate(c => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  ok(`${w}: overlay has real painted bars`, painted > 50, `px=${painted}`);
  ok(`${w}: overlay is not blocking clicks`, await ov.evaluate(c => getComputedStyle(c).pointerEvents) === "none");
  ok(`${w}: one AudioContext, one MediaElementSource`, (await pg.evaluate(() => [window.__ac, window.__mes])).join() === "1,1", (await pg.evaluate(() => [window.__ac, window.__mes])).join());
  // drawer toggle + persistence
  await pg.mouse.move(w / 2 + 4, 152); await pill.click(); await pg.waitForTimeout(400);
  ok(`${w}: pill opens drawer`, await pg.locator("#audio-bridge-drawer #audio-bridge-panel").count() === 1 && (await pill.getAttribute("aria-expanded")) === "true");
  ok(`${w}: drawer state persisted`, await pg.evaluate(() => localStorage.getItem("ajn_diagnostics_expanded")) === "1");
  await pg.mouse.move(w / 2, 150); await pill.click(); await pg.waitForTimeout(300);
  ok(`${w}: pill closes drawer`, await pg.locator("#audio-bridge-drawer").count() === 0 && await pg.evaluate(() => localStorage.getItem("ajn_diagnostics_expanded")) === "0");
  // reload keeps an opened drawer
  await pill.click(); await pg.waitForTimeout(200);
  await pg.reload(); await pg.waitForTimeout(1500);
  await pg.goto(BASE + "/#tv-guide"); await pg.waitForTimeout(1200); await pg.locator("[data-play-live]:not([disabled])").first().click(); await pg.waitForTimeout(2500);
  ok(`${w}: opened drawer survives reload`, await pg.locator("#audio-bridge-drawer").count() === 1);
  await pg.mouse.move(w / 2, 150); await pg.locator("[data-testid=analyzer-pill]").click(); await pg.waitForTimeout(200);
  // visualizer toggle
  await pg.mouse.move(w / 2, 150);
  const vbtn = pg.getByRole("button", { name: /visualizer/i });
  if (await pg.evaluate(() => document.querySelector("video").paused)) await pg.getByRole("button", { name: /^Play$/ }).click();
  await pg.waitForTimeout(800);
  await vbtn.click(); await pg.waitForTimeout(300);
  ok(`${w}: visualizer toggle off stops loop + persists`, (await ov.getAttribute("data-running")) === "0" && await pg.evaluate(() => localStorage.getItem("ajn_visualizer_enabled")) === "0");
  await pg.mouse.move(w / 2 + 3, 151); await vbtn.click(); await pg.waitForTimeout(500);
  ok(`${w}: visualizer toggle on resumes`, (await ov.getAttribute("data-running")) === "1");
  // paused → loop cancelled, rAF drops
  const raf1a = await pg.evaluate(() => window.__raf); await pg.waitForTimeout(1000); const playingRate = (await pg.evaluate(() => window.__raf)) - raf1a;
  await pg.getByRole("button", { name: /^Pause$/ }).click(); await pg.waitForTimeout(500);
  ok(`${w}: paused → overlay loop stopped, pill Idle`, (await ov.getAttribute("data-running")) === "0" && (await pg.locator("[data-testid=analyzer-pill]").getAttribute("data-state")) === "idle");
  const raf2a = await pg.evaluate(() => window.__raf); await pg.waitForTimeout(1000); const pausedRate = (await pg.evaluate(() => window.__raf)) - raf2a;
  ok(`${w}: rAF calls/s drop when paused`, pausedRate < playingRate / 4, `playing=${playingRate} paused=${pausedRate}`);
  ok(`${w}: no horizontal scroll`, await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok(`${w}: no page errors`, errs.length === 0, errs.join("|").slice(0, 200));
  await pg.screenshot({ path: `/tmp/p34_${w}.png` });
  await ctx.close();
}
console.log(out.join("\n")); await b.close();
