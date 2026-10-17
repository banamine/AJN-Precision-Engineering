// A live radio stream whose first request hangs (no bytes, no error) must be retried by the progress watchdog (~8 s),
// not left on "Buffering…" for ever. Needs playwright, the app running (AJN_TEST_URL) and TONE (an mp3 path).
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.AJN_TEST_URL || "http://localhost:3000";
const tone = fs.readFileSync(process.env.TONE || "/tmp/tone.mp3");
const out = []; const ok = (n, c, x = "") => out.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`);
const STREAM = "https://fake-radio.example/live";
const item = { id: "id-live", src: STREAM, title: "Fake Live Radio", subtitle: "Test", mediaType: "audio", channelId: "radio:test", guideId: "audio-podcasts", programId: "radio:test:live:now", archivePath: STREAM, progressSeconds: 0, updatedAt: Date.now() - 60e3 };
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((seed) => { if (!localStorage.getItem("seeded")) { localStorage.setItem("seeded", "1"); localStorage.setItem("ajn.recentlyPlayed.v1", JSON.stringify([seed])); localStorage.setItem("ajn.nav.v1", JSON.stringify({ version: 1, destination: "player", guideId: null, scrollY: 0, scrollX: 0, savedAt: Date.now() })); } }, item);
const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
let hits = 0; const times = [];
await pg.route(STREAM + "*", async (route) => {
  hits++; times.push(Date.now());
  if (hits === 1) return; // hang: never answer
  return route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: tone });
});
await pg.route("**/api/**", async (route) => { const u = route.request().url(); if (/\/api\/(schedule|live-radio|home|archive)/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); return route.continue(); });
await pg.goto(BASE + "/#player"); await pg.waitForTimeout(1500);
const btn = pg.getByText(/Resume where you left off|tap Play/i).first();
await btn.click({ timeout: 8000 }).catch(() => {});
const t0 = Date.now();
let playingAt = null;
for (let i = 0; i < 40; i++) { await pg.waitForTimeout(1000); const st = await pg.evaluate(() => { const a = document.querySelector("[data-testid=audio-element]"); return a ? { p: a.paused, rs: a.readyState, ct: a.currentTime } : null; }); if (st && !st.p && st.rs >= 3 && st.ct > 0.3) { playingAt = Date.now() - t0; break; } }
ok("first request hung, a second request was made", hits >= 2, `hits=${hits}`);
ok("playback started after the retry", playingAt !== null, `playingAt=${playingAt} ms`);
ok("recovered in under 15 s (live radio watchdog 8 s + 1 s retry)", playingAt !== null && playingAt < 15000);
ok("no page errors", errs.length === 0, errs.join("|"));
console.log(out.join("\n")); await b.close(); process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
