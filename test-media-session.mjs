// Bluetooth/car controls (Media Session) + restore after the app was closed. Needs playwright, the app running (AJN_TEST_URL),
// /tmp/ta.mp3 + /tmp/tb.mp3 (12 s).  The OS side (a real car) is simulated by calling the handlers the page registered.
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.AJN_TEST_URL || "http://localhost:3000";
const files = { a: fs.readFileSync("/tmp/ta.mp3"), b: fs.readFileSync("/tmp/tb.mp3") };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const out = []; const ok = (n, c, x = "") => out.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`);
const item = (k, t, updatedAt) => ({ id: `id-${k}`, src: `/api/archive/proxy?path=${encodeURIComponent(`/download/t/${k}.mp3`)}`, title: t, subtitle: "Test Band", mediaType: "audio",
  channelId: "tch", guideId: "tg", programId: `p-${k}`, archivePath: `/download/t/${k}.mp3`, progressSeconds: 0, updatedAt });
const schedule = { channels: [{ id: "tch", name: "Test Channel", programs: ["a", "b"].map((k) => ({ id: `p-${k}`, guideId: "tg", channelId: "tch", title: `Track ${k}`, mediaType: "audio", archivePath: `/download/t/${k}.mp3` })) }] };
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function page(ctx) {
  const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/thumb.png", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await pg.route("**/api/archive/folder-art*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ images: [{ name: "cover.png", url: "/thumb.png" }] }) }));
  await pg.route("**/api/schedule*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(schedule) }));
  await pg.route("**/api/archive/proxy*", async (route) => {
    const u = new URL(route.request().url()); const k = decodeURIComponent(u.searchParams.get("path")).includes("/b.mp3") ? "b" : "a"; const buf = files[k]; const rng = route.request().headers()["range"];
    const h = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "access-control-allow-origin": "*", "cache-control": "no-store" };
    if (rng) { const m = /bytes=(\d+)-(\d*)/.exec(rng); const s = +m[1]; const e = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1); return route.fulfill({ status: 206, headers: { ...h, "content-range": `bytes ${s}-${e}/${buf.length}` }, body: buf.subarray(s, e + 1) }); }
    return route.fulfill({ status: 200, headers: h, body: buf });
  });
  return { pg, errs };
}
const hook = () => { // capture what the page registers with the OS
  window.__ms = {}; window.__msNull = 0; window.__pos = [];
  const ms = navigator.mediaSession; const orig = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (a, fn) => { if (fn) window.__ms[a] = fn; else window.__msNull++; return orig(a, fn); };
  const op = ms.setPositionState?.bind(ms); if (op) ms.setPositionState = (s) => { window.__pos.push(s ? { d: s.duration, p: s.position } : null); return op(s); };
};

// ---------- 1. controls while playing ----------
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(hook);
  await ctx.addInitScript((seed) => { if (!localStorage.getItem("seeded")) { localStorage.setItem("seeded", "1"); localStorage.setItem("ajn.recentlyPlayed.v1", JSON.stringify([seed])); } }, item("a", "Track a", Date.now() - 30 * 3600e3));
  const { pg, errs } = await page(ctx);
  await pg.goto(BASE + "/"); await pg.waitForTimeout(1200);
  ok("30 h old item is NOT auto-restored", (await pg.$$("[data-testid=audio-host]")).length === 0);
  await pg.locator("[data-testid=home-recent] button:has-text('Track a')").first().click();
  await pg.waitForFunction(() => { const a = document.querySelector("[data-testid=audio-host] audio"); return a && !a.paused && a.currentTime > 1.2; }, null, { timeout: 15000 });
  await pg.waitForTimeout(800);
  const s = await pg.evaluate(() => { const m = navigator.mediaSession; return { actions: Object.keys(window.__ms), title: m.metadata?.title, artist: m.metadata?.artist, art: m.metadata?.artwork?.map((a) => a.src), state: m.playbackState, pos: window.__pos.filter(Boolean).slice(-1)[0] }; });
  ok("all car actions registered", ["play", "pause", "stop", "seekto", "seekbackward", "seekforward", "previoustrack", "nexttrack"].every((a) => s.actions.includes(a)), s.actions.join(","));
  ok("metadata title/artist", s.title === "Track a" && s.artist === "Test Band", `${s.title} / ${s.artist}`);
  ok("cover art is an absolute URL", s.art?.length === 1 && /^http/.test(s.art[0]) && /thumb\.png$/.test(s.art[0]), JSON.stringify(s.art));
  ok("playbackState = playing", s.state === "playing", s.state);
  ok("position state has real duration", s.pos && s.pos.d > 10 && s.pos.d < 14, JSON.stringify(s.pos));
  // car turns off: the OS pauses the element; car turns on: it sends Play
  await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").pause()); await pg.waitForTimeout(400);
  ok("playbackState = paused after OS pause", (await pg.evaluate(() => navigator.mediaSession.playbackState)) === "paused");
  await pg.evaluate(() => window.__ms.play()); await pg.waitForTimeout(800);
  const r = await pg.evaluate(() => ({ paused: document.querySelector("[data-testid=audio-host] audio").paused, st: navigator.mediaSession.playbackState }));
  ok("car Play resumes the same track", !r.paused && r.st === "playing", JSON.stringify(r));
  await pg.evaluate(() => window.__ms.seekto({ seekTime: 8 })); await pg.waitForTimeout(400);
  ok("seekto works", (await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").currentTime)) >= 7.5);
  await pg.evaluate(() => window.__ms.nexttrack()); await pg.waitForTimeout(2500);
  ok("car Next -> track b", /b\.mp3/.test(decodeURIComponent(await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").currentSrc))));
  ok("title follows to track b", (await pg.evaluate(() => navigator.mediaSession.metadata?.title)) === "Track b");
  await pg.waitForTimeout(3500);
  await pg.evaluate(() => window.__ms.previoustrack()); await pg.waitForTimeout(600);
  ok("car Prev after >3 s restarts the track", (await pg.evaluate(() => { const a = document.querySelector("[data-testid=audio-host] audio"); return /b\.mp3/.test(decodeURIComponent(a.currentSrc)) && a.currentTime < 2; })));
  await pg.evaluate(() => { document.querySelector("[data-testid=audio-host] audio").currentTime = 0.5; }); await pg.waitForTimeout(300);
  await pg.evaluate(() => window.__ms.previoustrack()); await pg.waitForTimeout(2500);
  ok("car Prev at the start -> track a", /a\.mp3/.test(decodeURIComponent(await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").currentSrc))));
  ok("handlers never torn down mid-session", (await pg.evaluate(() => window.__msNull)) === 0);
  ok("no page errors", errs.length === 0, errs.join("|"));
  await ctx.close();
}

// ---------- 2. app was closed/killed, reopened: restored, waits for Play ----------
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(hook);
  await ctx.addInitScript((seed) => { if (!localStorage.getItem("seeded")) { localStorage.setItem("seeded", "1"); localStorage.setItem("ajn.recentlyPlayed.v1", JSON.stringify([seed])); localStorage.setItem("ajn-playback-position:p-a", "7"); } }, item("a", "Track a", Date.now() - 3600e3));
  const { pg, errs } = await page(ctx);
  await pg.goto(BASE + "/"); await pg.waitForTimeout(2500);
  const st = await pg.evaluate(() => { const a = document.querySelector("[data-testid=audio-host] audio"); return { has: !!a, paused: a?.paused, t: a?.currentTime, muted: a?.muted, ms: navigator.mediaSession.metadata?.title, hasPlay: !!window.__ms?.play }; });
  ok("last track restored on launch, NOT playing", st.has && st.paused === true, JSON.stringify(st));
  ok("media session ready before any tap", st.ms === "Track a" && st.hasPlay);
  await pg.evaluate(() => { location.hash = "#player"; }); await pg.waitForTimeout(600);
  ok("'tap Play to resume' shown", (await pg.locator("[data-testid=autoplay-blocked]").count()) === 1);
  await pg.evaluate(() => window.__ms.play()); await pg.waitForTimeout(1500);   // steering-wheel Play on the car
  const p = await pg.evaluate(() => { const a = document.querySelector("[data-testid=audio-host] audio"); return { paused: a.paused, t: a.currentTime, muted: a.muted }; });
  ok("car Play resumes from the saved position (~7 s)", !p.paused && p.t >= 6.5, JSON.stringify(p));
  ok("sound is ON after Play (not the silent muted default)", p.muted === false, `muted=${p.muted}`);
  ok("prompt gone after play", (await pg.locator("[data-testid=autoplay-blocked]").count()) === 0);
  ok("no page errors", errs.length === 0, errs.join("|"));
  await ctx.close();
}
// ---------- 3. a video item is never restored ----------
{
  const ctx = await b.newContext();
  await ctx.addInitScript((seed) => { if (!localStorage.getItem("seeded")) { localStorage.setItem("seeded", "1"); localStorage.setItem("ajn.recentlyPlayed.v1", JSON.stringify([seed])); } }, { ...item("a", "Vid", Date.now()), mediaType: "video" });
  const { pg } = await page(ctx); await pg.goto(BASE + "/"); await pg.waitForTimeout(1500);
  ok("video item not restored", (await pg.$$("video, audio")).length === 0);
  await ctx.close();
}
console.log(out.join("\n")); await b.close(); process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
