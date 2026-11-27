import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.PRISM_TEST_PORT || 5201);
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
    try { if ((await fetch(`${origin}/test-prism-compact.html`)).ok) return; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Vite did not become ready\n${viteOutput}`);
}
const exists = (p) => access(p).then(() => true).catch(() => false);


async function main() {
  await waitForVite();
  const executablePath = process.env.CHROMIUM_PATH || (await exists("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : chromium.executablePath());
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 400, height: 500 } })).newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  for (const w of [340, 390]) {
    await page.setViewportSize({ width: w + 20, height: 500 });
    await page.goto(`${origin}/test-prism-compact.html?w=${w}`);
    const prism = page.getByTestId("source-prism-3d"); await prism.waitFor();
    const h = (await prism.boundingBox()).height;
    assert.ok(h <= 190, `w${w}: whole prism incl. tabs is short (${Math.round(h)}px, was ~420)`);
    for (const [key, id] of [["radio", "radio-mode-live"], ["music", "radio-mode-archive"], ["podcasts", "radio-mode-podcasts"], ["listenback", "radio-mode-listenback"]]) {
      await page.getByTestId(id).click(); await delay(750);
      const face = page.locator('[role="tabpanel"][aria-hidden="false"]');
      assert.equal(await face.count(), 1, `w${w} ${key}: one visible face`);
      const o = await face.evaluate((e) => ({ x: e.scrollWidth - e.clientWidth, y: e.scrollHeight - e.clientHeight }));
      assert.ok(o.x <= 1 && o.y <= 1, `w${w} ${key}: face content fits (${JSON.stringify(o)})`);
      const tab = await page.getByTestId(id).evaluate((e) => e.scrollWidth - e.clientWidth);
      assert.ok(tab <= 1, `w${w} ${key}: tab label fits`);
      if (process.env.SHOT && w === 340) await prism.screenshot({ path: `${process.env.SHOT}-${key}.png` });
    }
  }
  assert.deepEqual(errs, [], "no page errors");
  console.log("prism compact browser test ok");
}
main().then(async () => { await browser?.close(); await stopVite(); }, async (e) => { console.error(e); await browser?.close(); await stopVite(); process.exitCode = 1; });
