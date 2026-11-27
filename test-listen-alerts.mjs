import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.LISTEN_ALERTS_TEST_PORT || 5198);
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
    try { if ((await fetch(`${origin}/test-listen-alerts.html`)).ok) return; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Vite did not become ready\n${viteOutput}`);
}
const exists = (p) => access(p).then(() => true).catch(() => false);

const STATUS = {
  state: "ready", error: null, builtAt: new Date("2026-11-26T20:00:00Z").toISOString(),
  window: { days: 14, episodesPerShow: 20, archiveAfterDays: 30, eligibleShare: 0.8 }, source: "publisher transcript",
  covered: [{ showId: "a", name: "Show A", reason: "", warnings: [] }], archive: [{ showId: "b", name: "Old Show B", reason: "newest episode is 60 days old", warnings: [] }],
  uncovered: [{ showId: "c", name: "Show C", reason: "the feed publishes no transcripts", warnings: [] }], quarantined: [], warnings: [], stats: null, indexedEpisodes: 15,
};
const HIT = (over) => ({ id: "h1", ruleId: "x", ruleName: "Competitors", termType: "competitor", term: "Acme Corp", matchedTerms: ["Acme Corp"], showId: "a", showName: "Show A", channelId: "pod-a", programId: "pod-a-x1", guid: "g1", title: "Episode One", publishedAt: Date.parse("2026-11-25T12:00:00Z"), url: "https://cdn.example/a/1.mp3", cueIndex: 10, cueStart: 100, cueEnd: 104, snippet: "Tonight Acme Corp reported earnings.", archive: false, timing: "clean-show", ...over });

let mode = "ok"; const posted = []; let statusCalls = 0;
async function main() {
  await waitForVite();
  const executablePath = process.env.CHROMIUM_PATH || (await exists("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : chromium.executablePath());
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = []; page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); }); page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.route("**/api/alerts/status", async (route) => {
    statusCalls++;
    if (mode === "down") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    if (mode === "building") return route.fulfill({ json: { ...STATUS, state: "building", builtAt: null, covered: [], archive: [], uncovered: [] } });
    return route.fulfill({ json: STATUS });
  });
  await page.route("**/api/alerts/match", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}"); posted.push(body);
    const hits = body.rules?.length ? [HIT(), HIT({ id: "h2", programId: "pod-b-y", showId: "b", showName: "Old Show B", archive: true, title: "Old episode", snippet: "Acme in an old show." })] : [];
    return route.fulfill({ json: { state: "ready", builtAt: STATUS.builtAt, hits, scanned: 15, truncated: false, rules: body.rules?.length ?? 0 } });
  });

  await page.goto(`${origin}/test-listen-alerts.html`);
  await page.getByTestId("alerts-toggle").waitFor();
  assert.equal(statusCalls, 0, "no network until the panel is opened");
  assert.equal(await page.getByTestId("alerts-toggle").innerText(), "OPEN ALERTS");

  // open: status line states the window and the source
  await page.getByTestId("alerts-toggle").click();
  await page.getByTestId("alerts-status").waitFor();
  const status = await page.getByTestId("alerts-status").innerText();
  assert.match(status, /last 14 days/); assert.match(status, /published transcript/); assert.equal(posted.length, 0, "no rules, so nothing is sent");

  // a rule that cannot be saved says why
  await page.getByTestId("alert-save").click();
  assert.match(await page.getByTestId("alerts-note").innerText(), /name and at least one word/);

  // create a rule
  await page.getByTestId("alert-name").fill("Competitors");
  await page.getByTestId("alert-term-type").selectOption("competitor");
  await page.getByTestId("alert-term-text").fill("Acme Corp");
  await page.getByTestId("alert-term-aliases").fill("Acme, ACME inc");
  await page.getByTestId("alert-save").click();
  await page.getByTestId("alert-hit").first().waitFor();
  assert.equal(posted.length, 1); assert.equal(posted[0].rules[0].name, "Competitors");
  assert.deepEqual(posted[0].rules[0].terms[0], { type: "competitor", text: "Acme Corp", aliases: ["Acme", "ACME inc"] });
  assert.deepEqual(posted[0].rules[0].scope, { kind: "all" });
  assert.equal(await page.getByTestId("alert-hit").count(), 1, "the old-show match is hidden under its own toggle");
  assert.match(await page.getByTestId("alert-count").innerText(), /1 hit.*1 new/);
  assert.match(await page.getByTestId("alert-snippet").innerText(), /Acme Corp reported earnings/);
  assert.match(await page.getByTestId("alert-hit").first().innerText(), /publisher transcript time/);
  assert.match(await page.getByTestId("alerts-toggle").innerText(), /1 NEW/);

  // library matches are separate and never counted as new
  await page.getByTestId("alert-library-toggle").click();
  assert.equal(await page.getByTestId("alert-hit").count(), 2); assert.match(await page.getByTestId("alert-library-toggle").innerText(), /LIBRARY MATCH/);

  // play from here: the episode, its channel, and a start 8 s before the cue
  await page.getByTestId("alert-play").first().click();
  const plays = await page.evaluate(() => window.__plays);
  assert.equal(plays.length, 1);
  assert.deepEqual(plays[0].slice(0, 7), ["https://cdn.example/a/1.mp3", "Episode One", "Show A", "audio", "pod-a", "audio-podcasts", "pod-a-x1"]);
  assert.equal(plays[0][9], 92, "cue at 100 s, 8 s lead-in");
  assert.doesNotMatch(await page.getByTestId("alerts-toggle").innerText(), /NEW/, "playing a hit marks it seen");

  // coverage is stated, including who is NOT covered
  await page.getByTestId("alert-coverage-toggle").click();
  const cov = await page.getByTestId("alert-coverage").innerText();
  assert.match(cov, /Watched \(1\): Show A/); assert.match(cov, /Not covered.*Show C/s); assert.match(cov, /Old Show B/);

  // rules and seen survive a reload; nothing is fetched until opened again
  await page.reload(); await page.getByTestId("alerts-toggle").waitFor();
  await page.getByTestId("alerts-toggle").click();
  await page.getByTestId("alert-rule").first().waitFor(); await page.getByTestId("alert-hit").first().waitFor();
  assert.doesNotMatch(await page.getByTestId("alerts-toggle").innerText(), /NEW/, "seen list persisted");
  assert.equal(await page.getByTestId("alert-rule").count(), 1);
  // turning a rule off stops sending it
  const before = posted.length;
  await page.getByRole("checkbox", { name: "Competitors on or off" }).uncheck();
  await page.waitForTimeout(300);
  assert.equal(posted.length, before, "with no active rule nothing is sent"); assert.equal(await page.getByTestId("alert-hit").count(), 0);
  await page.getByRole("checkbox", { name: "Competitors on or off" }).check();
  await page.getByTestId("alert-hit").first().waitFor();
  await page.getByRole("button", { name: "Delete Competitors" }).click();
  assert.equal(await page.getByTestId("alert-rule").count(), 0);

  // skip bar: no alert group without hits
  assert.equal(await page.getByTestId("skip-next-hit").count(), 0);
  assert.equal(await page.getByTestId("skip-prev-cue").isEnabled(), true);
  // rapid Next line taps stack on the last target (the captions still say 10)
  await page.getByTestId("skip-next-cue").click(); await page.getByTestId("skip-next-cue").click(); await page.getByTestId("skip-next-cue").click();
  assert.deepEqual(await page.evaluate(() => window.__jumps), [11, 12, 13]);
  await page.waitForTimeout(1300);
  await page.getByTestId("skip-prev-cue").click();
  assert.deepEqual((await page.evaluate(() => window.__jumps)).slice(-1), [9], "after the window the shown line is the base again");
  // rapid time nudges stack too, and the buttons are labelled for screen readers
  await page.evaluate(() => { window.__media.currentTime = 100; });
  assert.equal(await page.getByTestId("skip-nudge-10").getAttribute("aria-label"), "Skip forward 10 seconds");
  await page.getByTestId("skip-nudge-10").click(); await page.getByTestId("skip-nudge-10").click();
  assert.equal(await page.evaluate(() => window.__media.currentTime), 120);

  // hits for THIS episode only; Next / Previous / Return
  await page.evaluate((h) => window.__setHits([{ ...h, id: "e1", cueIndex: 5 }, { ...h, id: "e2", cueIndex: 20 }, { ...h, id: "e3", cueIndex: 35 }, { ...h, id: "other", programId: "pod-z-q", cueIndex: 12 }]), HIT());
  await page.getByTestId("skip-next-hit").waitFor();
  assert.match(await page.getByRole("group", { name: "Alert hits in this episode" }).innerText(), /3 alerts/i);
  await page.evaluate(() => { window.__jumps.length = 0; });
  await page.waitForTimeout(1300);
  await page.getByTestId("skip-next-hit").click(); await page.getByTestId("skip-next-hit").click();
  assert.deepEqual(await page.evaluate(() => window.__jumps), [20, 35], "second quick tap goes on from the first target");
  await page.waitForTimeout(1300); await page.evaluate(() => { window.__jumps.length = 0; });
  await page.getByTestId("skip-prev-hit").click(); assert.deepEqual(await page.evaluate(() => window.__jumps), [5], "from line 10 the previous alert is the one at line 5");
  await page.getByTestId("skip-return-hit").click(); assert.deepEqual((await page.evaluate(() => window.__jumps)).slice(-1), [5], "return = the alert at or before the line");
  await page.evaluate(() => window.__setHits([]));
  await page.waitForTimeout(100); assert.equal(await page.getByTestId("skip-next-hit").count(), 0);

  // failures are shown, not hidden
  mode = "down"; await page.reload(); await page.getByTestId("alerts-toggle").click();
  await page.getByTestId("alerts-error").waitFor(); assert.match(await page.getByTestId("alerts-error").innerText(), /unavailable.*500/);
  mode = "building"; await page.reload(); await page.getByTestId("alerts-toggle").click();
  await page.getByTestId("alerts-status").waitFor(); assert.match(await page.getByTestId("alerts-status").innerText(), /Building the transcript index/);


  // ===== the real PodcastStage: captions auto-on, skip bar beside them, per-show off switch
  const CUES = Array.from({ length: 40 }, (_, i) => ({ s: i * 10, e: i * 10 + 4, t: `line ${i}` }));
  let tr = "ok";
  await page.route("**/api/podcast/transcript*", (route) => route.fulfill({ json: tr === "ok" ? { available: true, cues: CUES, hasSpeakers: false, endsAt: 394, feedSeconds: 3000 } : { available: false, reason: "no-transcript", cues: [], hasSpeakers: false, endsAt: null, feedSeconds: null } }));
  await page.route("**/api/podcast/ad-map*", (route) => route.fulfill({ json: { feedSeconds: 3000, adMap: null } }));
  const stage = `${origin}/test-listen-alerts.html?stage=1`;
  await page.goto(stage);
  await page.getByTestId("captions-list").waitFor();
  assert.equal(await page.getByTestId("captions-state").getAttribute("data-state"), "in-sync");
  assert.match(await page.getByTestId("caption-current").innerText(), /line 10/, "captions follow the playhead by themselves");
  await page.getByTestId("alert-skip-bar").waitFor();
  // the caption options live in the bottom row with the skip buttons, not in the header
  assert.equal(await page.getByTestId("alert-skip-bar").getByTestId("captions-options").count(), 1, "options sit in the skip row");
  for (const id of ["captions-hide", "captions-tapmode"]) assert.equal(await page.getByTestId("captions").locator(`div:has(> [data-testid=captions-state]) [data-testid=${id}]`).count(), 0, `${id} is not in the header`);
  assert.equal((await page.getByTestId("captions-art").innerText()).trim(), "SA", "no artwork: initials, never an invented picture");
  await page.getByTestId("skip-next-cue").click();
  assert.ok(Math.abs((await page.evaluate(() => window.__audio.currentTime)) - 110) < 0.01, "Next line plays from the next caption line (110 s in an un-stitched file)");
  await page.getByTestId("skip-nudge-10").click();
  assert.ok(Math.abs((await page.evaluate(() => window.__audio.currentTime)) - 120) < 0.01);
  await page.goto(`${stage}&art=1`); await page.getByTestId("captions-list").waitFor();
  assert.equal(await page.getByTestId("captions-art").locator("img").count(), 1, "artwork shows when there is some");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.goto(stage); await page.getByTestId("captions-list").waitFor();
  // off for this show only, remembered
  await page.getByTestId("captions-hide").click();
  assert.equal(await page.getByTestId("captions-list").count(), 0); assert.equal(await page.getByTestId("alert-skip-bar").count(), 0);
  assert.match(await page.getByTestId("captions-none").innerText(), /off for this show/);
  assert.equal(await page.evaluate(() => localStorage.getItem("ajn-captions-hidden:pod-a")), "1");
  await page.reload(); await page.getByTestId("captions-show").waitFor();
  assert.equal(await page.getByTestId("captions-list").count(), 0, "stays off after a reload");
  await page.goto(`${stage}&show=pod-z`); await page.getByTestId("captions-list").waitFor();   // another show is unaffected
  await page.goto(stage); await page.getByTestId("captions-show").click(); await page.getByTestId("captions-list").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("ajn-captions-hidden:pod-a")), "0");
  // an episode without a transcript: no caption box, no empty skip bar, no hide switch (unchanged behaviour)
  tr = "none"; await page.reload(); await page.getByTestId("captions-none").waitFor();
  assert.equal(await page.getByTestId("captions-list").count(), 0); assert.equal(await page.getByTestId("alert-skip-bar").count(), 0); assert.equal(await page.getByTestId("captions-hide").count(), 0); assert.equal(await page.getByTestId("captions-show").count(), 0);

  await page.screenshot({ path: "/tmp/listen-alerts.png", fullPage: true });
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
  console.log("listen alerts browser test passed");
}
try { await main(); } finally { await browser?.close().catch(() => {}); await stopVite(); }
