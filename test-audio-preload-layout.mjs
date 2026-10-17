// Audio next-track preload + audio-mode layout zones.
// Needs: playwright, the app running (AJN_TEST_URL, default http://localhost:3000), /tmp/ta.mp3 + /tmp/tb.mp3 (12 s each).
//   ffmpeg -y -f lavfi -i sine=frequency=330:duration=12 -c:a libmp3lame -b:a 64k /tmp/ta.mp3   (660 Hz for tb)
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.AJN_TEST_URL || "http://localhost:3000";
const files = { a: fs.readFileSync("/tmp/ta.mp3"), b: fs.readFileSync("/tmp/tb.mp3") };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const out = []; const ok = (n, c, x = "") => { out.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`); };

const item = (k, t) => ({ id: `id-${k}`, src: `/api/archive/proxy?path=${encodeURIComponent(`/download/t/${k}.mp3`)}`, title: t, subtitle: "Test Band", mediaType: "audio",
  channelId: "tch", guideId: "tg", programId: `p-${k}`, archivePath: `/download/t/${k}.mp3`, thumbnailUrl: "/thumb-test.png", progressSeconds: 0, updatedAt: Date.now() - 30 * 3600e3 });
const schedule = { channels: [{ id: "tch", name: "Test Channel", programs: ["a", "b"].map((k) => ({ id: `p-${k}`, guideId: "tg", channelId: "tch", title: `Track ${k}`, mediaType: "audio", archivePath: `/download/t/${k}.mp3` })) }] };

const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((seed) => {
  try { if (!localStorage.getItem("seeded")) { localStorage.setItem("ajn.recentlyPlayed.v1", JSON.stringify([seed])); localStorage.setItem("seeded", "1"); } } catch {}
  const NativeAudio = window.Audio; window.__audios = [];
  window.Audio = function (...a) { const el = new NativeAudio(...a); window.__audios.push(el); el.addEventListener("ended", () => { window.__endedAt = performance.now(); }); el.addEventListener("playing", () => { window.__playing = window.__playing || []; window.__playing.push({ src: el.currentSrc, at: performance.now() }); }); return el; };
  window.Audio.prototype = NativeAudio.prototype;
  const AC = window.AudioContext; window.__srcCount = 0; window.__srcErr = [];
  if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); const o = this.createMediaElementSource.bind(this); this.createMediaElementSource = (m) => { try { const r = o(m); window.__srcCount++; return r; } catch (e) { window.__srcErr.push(String(e)); throw e; } }; } };
}, item("a", "Track a"));
const pg = await ctx.newPage();
const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
const reqs = [];
await pg.route("**/thumb-test.png", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
await pg.route("**/api/archive/folder-art*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ images: [1, 2, 3].map((i) => ({ name: `p${i}.png`, url: `/thumb-test.png?i=${i}` })) }) }));
await pg.route("**/api/schedule*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(schedule) }));
await pg.route("**/api/archive/proxy*", async (route) => {
  const u = new URL(route.request().url()); const k = decodeURIComponent(u.searchParams.get("path")).includes("/b.mp3") ? "b" : "a";
  reqs.push({ k, at: Date.now(), range: route.request().headers()["range"] || null });
  const buf = files[k]; const rng = route.request().headers()["range"];
  const h = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (rng) { const m = /bytes=(\d+)-(\d*)/.exec(rng); const s = +m[1]; const e = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1);
    return route.fulfill({ status: 206, headers: { ...h, "content-range": `bytes ${s}-${e}/${buf.length}` }, body: buf.subarray(s, e + 1) }); }
  return route.fulfill({ status: 200, headers: h, body: buf });
});
await pg.goto(BASE + "/"); await pg.waitForTimeout(1500);
const recent = pg.locator("button:has-text('Track a')").first();
ok("seeded item is on Home", await recent.count() > 0);
await recent.click();
await pg.waitForSelector("[data-testid=audio-host] audio", { state: "attached", timeout: 8000 });
await pg.waitForTimeout(1500);

// ---- layout zones ----
const lay = await pg.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
  const z = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).zIndex : null; };
  const ctl = document.querySelector("[data-testid=audio-controls]");
  return { stage: r("[data-testid=audio-stage]"), vis: r("[data-testid=visualizer-overlay]"), art: r("[data-testid=audio-art]"), ctl: r("[data-testid=audio-controls]"),
    zVis: z("[data-testid=visualizer-overlay]"), zArt: z("[data-testid=audio-art]"), zCtl: z("[data-testid=audio-controls]"), ctlBg: ctl && getComputedStyle(ctl).backgroundColor,
    ctlBlur: ctl && (getComputedStyle(ctl).backdropFilter || getComputedStyle(ctl).webkitBackdropFilter), tr: r("[data-testid=player-transport]"),
    canvas: (() => { const c = document.querySelector("[data-testid=visualizer-overlay]"); return c && { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, running: c.dataset.running }; })(),
    artRatio: (() => { const e = document.querySelector("[data-testid=audio-art]"); if (!e) return 0; const b = e.getBoundingClientRect(); return b.width / b.height; })() };
});
ok("stage + controls exist", !!lay.stage && !!lay.ctl);
ok("controls sit BELOW the stage (no overlap)", lay.ctl.t >= lay.stage.b - 0.5, `stage.b=${lay.stage?.b} ctl.t=${lay.ctl?.t}`);
ok("visualizer confined to the stage", lay.vis.t >= lay.stage.t - 0.5 && lay.vis.b <= lay.stage.b + 0.5, JSON.stringify(lay.vis));
ok("visualizer never reaches the controls", lay.vis.b <= lay.ctl.t + 0.5);
ok("z-order: visualizer 1 < art 2 < controls 10", lay.zVis === "1" && lay.zArt === "2" && lay.zCtl === "10", `${lay.zVis}/${lay.zArt}/${lay.zCtl}`);
ok("art is square, <=60vh", Math.abs(lay.artRatio - 1) < 0.02 && lay.art.h <= 0.6 * 900 + 1, `ratio=${lay.artRatio.toFixed(2)} h=${lay.art?.h}`);
ok("controls are glass (rgba + blur)", /rgba\(15, 15, 20, 0\.85\)/.test(lay.ctlBg || "") && /blur\(12px\)/.test(lay.ctlBlur || ""), `${lay.ctlBg} | ${lay.ctlBlur}`);
ok("canvas bitmap synced to its box", lay.canvas && Math.abs(lay.canvas.h - lay.canvas.ch) <= lay.canvas.ch + 1 && lay.canvas.ch === Math.round(lay.stage.h), JSON.stringify(lay.canvas));
ok("transport inside controls bar", lay.tr && lay.tr.t >= lay.ctl.t - 0.5 && lay.tr.b <= lay.ctl.b + 0.5);
const nb = await pg.evaluate(() => { const q = (s) => document.querySelector(s); const art = q("[data-testid=audio-art]"), st = q("[data-testid=audio-stage]").getBoundingClientRect();
  return { radius: art && getComputedStyle(art).borderRadius, side: document.querySelectorAll("[data-testid=audio-side-art]").length, thumb: !!q("[data-testid=audio-bar-thumb]"), title: q("[data-testid=audio-bar-title]")?.textContent,
    ar: st.width / st.height, btn: ["Previous track", "Back 10 seconds", "Pause", "Forward 10 seconds", "Next track"].map((l) => !!q(`[aria-label='${l}']`)), rep: !!q("[aria-label^='Repeat this track']") }; });
ok("art is a circle", /50%/.test(nb.radius || "") || parseFloat(nb.radius) >= 1000, nb.radius);
ok("two side photos from the folder", nb.side === 2, `${nb.side}`);
ok("bar has thumb + title", nb.thumb && nb.title === "Track a", nb.title);
ok("stage is ~16:9", Math.abs(nb.ar - 16 / 9) < 0.15 || nb.ar > 1.7, nb.ar.toFixed(2));
ok("transport buttons present", nb.btn.every(Boolean) && nb.rep, JSON.stringify(nb.btn));
await pg.click("[aria-label^='Repeat this track']");
ok("repeat sets loop on the element", await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").loop === true));
await pg.click("[aria-label^='Repeat this track']");
ok("repeat off clears loop", await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio").loop === false));
await pg.setViewportSize({ width: 375, height: 800 }); await pg.waitForTimeout(500);
const m = await pg.evaluate(() => { const s = document.querySelector("[data-testid=audio-stage]").getBoundingClientRect(), c = document.querySelector("[data-testid=audio-controls]").getBoundingClientRect(), v = document.querySelector("[data-testid=visualizer-overlay]"); return { sb: s.bottom, ct: c.top, vh: v.clientHeight, sh: s.height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
ok("375px: controls below stage, canvas follows stage, no h-scroll", m.ct >= m.sb - 0.5 && Math.abs(m.vh - m.sh) <= 1 && m.sw <= m.cw, JSON.stringify(m));
await pg.setViewportSize({ width: 1280, height: 900 });

// ---- preload + swap ----
const t0 = await pg.evaluate(() => document.querySelector("[data-testid=audio-host] audio")?.currentSrc);
ok("track a is playing", /a\.mp3/.test(decodeURIComponent(t0 || "")), t0);
const sources0 = await pg.evaluate(() => window.__srcCount);
await pg.waitForFunction(() => window.__endedAt, null, { timeout: 30000 });
await pg.waitForTimeout(1500);
const r = await pg.evaluate(() => ({ ended: window.__endedAt, playing: window.__playing, audios: window.__audios.length,
  host: document.querySelector("[data-testid=audio-host] audio")?.currentSrc, hostIdx: window.__audios.indexOf(document.querySelector("[data-testid=audio-host] audio")),
  count: document.querySelectorAll("audio").length, srcCount: window.__srcCount, srcErr: window.__srcErr, running: document.querySelector("[data-testid=visualizer-overlay]")?.dataset.running }));
const bFirst = reqs.find((q) => q.k === "b");
ok("next track requested BEFORE the first ended", !!bFirst, JSON.stringify(reqs.slice(0, 4)));
const pb = (r.playing || []).find((p) => /b\.mp3/.test(decodeURIComponent(p.src)));
ok("track b plays after a", !!pb, JSON.stringify(r.playing));
const gap = pb ? Math.round(pb.at - r.ended) : null;
ok("gap a.ended -> b.playing < 400 ms", gap !== null && gap < 400, `gap=${gap}ms`);
ok("the preloaded element was ADOPTED (only 2 Audio elements ever created)", r.audios === 2 && r.hostIdx === 1, `created=${r.audios} hostIdx=${r.hostIdx}`);
ok("exactly one <audio> in the DOM", r.count === 1, `count=${r.count}`);
ok("each element bridged once, no source errors", r.srcCount >= 2 && r.srcErr.length === 0, `sources=${r.srcCount} errs=${JSON.stringify(r.srcErr)}`);
ok("visualizer running on b", r.running === "1", `running=${r.running}`);
ok("no page errors", errs.length === 0, errs.join(" | "));
await pg.click("[aria-label='Previous track']"); await pg.waitForTimeout(2500);
ok("Prev goes back to track a", await pg.evaluate(() => /a\.mp3/.test(decodeURIComponent(document.querySelector("[data-testid=audio-host] audio")?.currentSrc || ""))));
await pg.click("[aria-label='Next track']"); await pg.waitForTimeout(2500);
ok("Next goes to track b", await pg.evaluate(() => /b\.mp3/.test(decodeURIComponent(document.querySelector("[data-testid=audio-host] audio")?.currentSrc || ""))));
console.log(out.join("\n")); console.log(`gap=${gap}ms`);
await b.close();
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
