import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.MINI_PANELS_TEST_PORT || 5200);
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
    try { if ((await fetch(`${origin}/test-mini-panels.html`)).ok) return; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Vite did not become ready\n${viteOutput}`);
}
const exists = (p) => access(p).then(() => true).catch(() => false);


async function main() {
  await waitForVite();
  const executablePath = process.env.CHROMIUM_PATH || (await exists("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : chromium.executablePath());
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  for (const w of [420, 340]) {
    await page.goto(`${origin}/test-mini-panels.html?w=${w}&badge=1`);
    const box = page.getByTestId("mini-rotator"); await box.waitFor();
    const r = await box.boundingBox();
    assert.ok(r.width <= w, `w${w}: box fits its card (${r.width})`);
    assert.ok(r.height < 230, `w${w}: box stays small (${r.height}px)`);
    for (const key of ["now", "next", "digest", "alerts"]) {
      await page.getByTestId(`mini-dot-${key}`).click();
      const sw = await page.getByTestId(`mini-panel-${key}`).evaluate((e) => ({ x: e.scrollWidth - e.clientWidth, y: e.scrollHeight - e.clientHeight }));
      assert.ok(sw.x <= 1, `w${w} ${key}: no sideways spill (${sw.x})`);
      assert.ok(sw.y <= 1, `w${w} ${key}: content fits the fixed height (${sw.y})`);
    }
    assert.equal(await page.getByTestId("mini-dot-alerts").locator("i").evaluate((e) => e.className.includes("ring-2")), true, `w${w}: alert dot ring`);
  }
  await page.goto(`${origin}/test-mini-panels.html`);
  assert.equal(await page.getByTestId("mini-title").textContent(), "Now playing");
  await page.getByTestId("mini-next").click(); assert.equal(await page.getByTestId("mini-title").textContent(), "Up next", "next moves one panel");
  await page.getByTestId("mini-prev").click(); await page.getByTestId("mini-prev").click(); assert.equal(await page.getByTestId("mini-title").textContent(), "Alerts", "prev wraps to the last panel");
  await page.getByTestId("mini-next").click(); assert.equal(await page.getByTestId("mini-title").textContent(), "Now playing", "next wraps to the first");
  await page.getByTestId("mini-next").focus(); await page.keyboard.press("ArrowRight"); assert.equal(await page.getByTestId("mini-title").textContent(), "Up next", "ArrowRight while focus is inside");
  await page.keyboard.press("ArrowLeft"); assert.equal(await page.getByTestId("mini-title").textContent(), "Now playing", "ArrowLeft while focus is inside");
  await page.getByTestId("outside").focus(); await page.keyboard.press("ArrowRight"); assert.equal(await page.getByTestId("mini-title").textContent(), "Now playing", "arrows outside the box do nothing");
  assert.equal(await page.getByTestId("mini-dot-alerts").locator("i").evaluate((e) => e.className.includes("ring-2")), false, "no ring without a badge");
  const b = await page.getByTestId("mini-panel-now").boundingBox(); await page.mouse.move(b.x + 30, b.y + 60); await page.mouse.down(); await page.mouse.move(b.x + 200, b.y + 60, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.getByTestId("mini-title").textContent(), "Alerts", "swipe right goes back one");
  assert.deepEqual(errs, [], "no page errors");
  console.log("mini panels browser test ok");
}
main().then(async () => { await browser?.close(); await stopVite(); }, async (e) => { console.error(e); await browser?.close(); await stopVite(); process.exitCode = 1; });
