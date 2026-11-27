import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.LISTEN_CAROUSEL_TEST_PORT || 5199);
const origin = `http://127.0.0.1:${port}`;
const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: process.cwd(), env: { ...process.env, NET_GUARD: "block", NODE_ENV: "test" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let viteOutput = ""; vite.stdout.on("data", (c) => { viteOutput += String(c); }); vite.stderr.on("data", (c) => { viteOutput += String(c); });
let browser;
async function stopVite() {
  if (vite.exitCode !== null) return;
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  await Promise.race([new Promise((r) => vite.once("exit", r)), delay(2000)]);
  if (vite.exitCode === null) { try { process.kill(-vite.pid, "SIGKILL"); } catch { vite.kill("SIGKILL"); } }
}
async function waitForVite() {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (vite.exitCode !== null) throw new Error(`Vite exited ${vite.exitCode}\n${viteOutput}`);
    try { if ((await fetch(`${origin}/test-listen-carousel.html`)).ok) return; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Vite did not become ready\n${viteOutput}`);
}
const exists = (p) => access(p).then(() => true).catch(() => false);


const exists2 = exists;
async function check(page, w, h, label) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${origin}/test-listen-carousel.html?badge=1`);
  await page.getByTestId("listen-carousel").waitFor();
  const docOver = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  assert.ok(docOver <= 1, `${label}: page scrolls by ${docOver}px`);
  const mini = await page.getByTestId("lc-mini").boundingBox();
  assert.ok(mini && mini.y + mini.height <= h + 1, `${label}: mini bar inside viewport`);
  await page.getByTestId("lc-dot-now").click();
  await delay(450);
  const act = await page.getByTestId("lc-panel-now").boundingBox();
  assert.ok(act && act.x >= 0 && act.x + act.width <= w + 1, `${label}: active panel inside viewport (${JSON.stringify(act)})`);
  const bodyScroll = await page.getByTestId("lc-panel-now").locator(".lc-body").evaluate((e) => e.scrollHeight > e.clientHeight);
  assert.ok(bodyScroll, `${label}: tall panel scrolls inside itself`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight <= 1), true, `${label}: still no page scroll`);
  if (w > 720) {
    const arrow = await page.getByTestId("lc-prev").boundingBox();
    assert.ok(arrow.x + arrow.width <= act.x + 1, `${label}: prev arrow sits in the gutter, not over the card`);
    const next = await page.getByTestId("lc-next").boundingBox();
    assert.ok(next.x >= act.x + act.width - 1, `${label}: next arrow sits in the gutter`);
  }
  assert.equal(await page.getByTestId("lc-dot-find").evaluate((e) => e.classList.contains("has-badge")), true, `${label}: badge ring on Find dot`);
  const titleOverflow = await page.locator(".lc-mini-text strong").evaluate((e) => e.scrollWidth > e.clientWidth);
  assert.ok(titleOverflow, `${label}: long title is truncated with ellipsis (clipped, not spilling)`);
  const miniRight = await page.getByTestId("lc-mini").evaluate((e) => e.scrollWidth - e.clientWidth);
  assert.ok(miniRight <= 1, `${label}: mini bar does not spill sideways`);
}
async function main() {
  await waitForVite();
  const executablePath = process.env.CHROMIUM_PATH || (await exists("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : chromium.executablePath());
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await check(page, 1280, 720, "desktop 1280x720");
  await check(page, 390, 800, "phone 390x800");
  // keyboard and mini bar (desktop)
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/test-listen-carousel.html`);
  await page.getByTestId("listen-carousel").waitFor();
  await page.keyboard.press("ArrowRight"); await delay(450);
  assert.equal(await page.getByTestId("lc-panel-now").getAttribute("aria-hidden"), "false", "ArrowRight moves one panel");
  await page.keyboard.press("ArrowLeft"); await delay(450);
  assert.equal(await page.getByTestId("lc-panel-deck").getAttribute("aria-hidden"), "false", "ArrowLeft moves back");
  await page.evaluate(() => { (window).__calls.length = 0; });
  for (const k of [" ", "j", "l", "m"]) await page.keyboard.press(k);
  assert.deepEqual(await page.evaluate(() => (window).__calls), ["toggle", "seek:27", "seek:72", "mute"], "Space, J, L, M");
  await page.getByTestId("lc-dot-listen").click(); await delay(450);
  await page.getByTestId("lc-mini-return").click(); await delay(450);
  assert.equal(await page.getByTestId("lc-panel-deck").getAttribute("aria-hidden"), "false", "mini bar art/title returns to the player panel");
  await page.getByTestId("lc-panel-deck").locator("input").focus();
  await page.evaluate(() => { (window).__calls.length = 0; });
  await page.keyboard.type("j l m "); 
  assert.deepEqual(await page.evaluate(() => (window).__calls), [], "shortcuts ignored while typing");
  assert.deepEqual(errs, [], "no page errors");
  console.log("listen-carousel browser test ok");
}
main().then(async () => { await browser?.close(); await stopVite(); }, async (e) => { console.error(e); await browser?.close(); await stopVite(); process.exitCode = 1; });
