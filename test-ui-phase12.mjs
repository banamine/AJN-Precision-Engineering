// Phase 1+2 UI check. Needs: ffmpeg, playwright, app running (AJN_TEST_URL, default http://localhost:3000).
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
const BASE = process.env.AJN_TEST_URL || "http://localhost:3000";
if (!fs.existsSync("/tmp/t60.webm")) execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=60:size=640x360:rate=10 -f lavfi -i sine=frequency=440:duration=60 -c:v libvpx -b:v 200k -c:a libvorbis -shortest /tmp/t60.webm");
const webm = fs.readFileSync("/tmp/t60.webm");
const b = await chromium.launch({ args:["--autoplay-policy=no-user-gesture-required"] });
const out = []; const ok=(n,c,x="")=>{out.push(`${c?"PASS":"FAIL"} ${n} ${x}`)};
for (const [w,h] of [[1920,1080],[1024,768],[768,1024],[375,800]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h} });
  const pg = await ctx.newPage();
  const errs=[]; pg.on("pageerror",e=>errs.push(String(e)));
  await pg.route("**/api/archive/proxy*", async (route)=>{
    const rng = route.request().headers()["range"]; 
    if (rng){ const m=/bytes=(\d+)-(\d*)/.exec(rng); const s=+m[1]; const e=Math.min(webm.length-1, m[2]?+m[2]:webm.length-1);
      return route.fulfill({status:206, headers:{"content-type":"video/webm","accept-ranges":"bytes","content-range":`bytes ${s}-${e}/${webm.length}`}, body:webm.subarray(s,e+1)}); }
    return route.fulfill({status:200, headers:{"content-type":"video/webm","accept-ranges":"bytes"}, body:webm});
  });
  await pg.goto(BASE+"/"); await pg.waitForTimeout(1500);
  // --- header ---
  const hh = await pg.evaluate(()=>document.getElementById("canonical-app-header").getBoundingClientRect().height);
  const brandText = await pg.evaluate(()=>{const e=document.querySelector("#brand-logo-btn span"); return e? getComputedStyle(e.parentElement).display:"none"});
  ok(`${w}: brand label ${w>=1024?"shown":"hidden"}`, w>=1024 ? brandText!=="none" : brandText==="none", `display=${brandText}`);
  if (w>=768){
    const labels = await pg.$$eval("nav[aria-label='Primary Destinations'] > button, nav[aria-label='Primary Destinations'] #nav-link-vault", els=>els.map(e=>e.textContent.trim()));
    ok(`${w}: primary tabs`, JSON.stringify(labels)==JSON.stringify(["Live","Guide","Player","News","Vault"]), JSON.stringify(labels));
    await pg.click("#nav-link-vault"); await pg.waitForTimeout(200);
    ok(`${w}: vault menu has Radio+Library`, (await pg.$$eval("[role=menuitem]",e=>e.map(x=>x.textContent)))[0].includes("AJN Radio"));
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(150);
    ok(`${w}: vault closes on Esc`, (await pg.$$("[role=menu]")).length===0);
    const w0 = await pg.evaluate(()=>document.getElementById("header-search").getBoundingClientRect().width);
    await pg.keyboard.press("/"); await pg.waitForTimeout(400);
    const w1 = await pg.evaluate(()=>document.getElementById("header-search").getBoundingClientRect().width);
    const focused = await pg.evaluate(()=>document.activeElement?.getAttribute("aria-label"));
    ok(`${w}: '/' expands search`, w0<=42 && w1>=250 && focused==="Search archive", `${w0}->${w1} focus=${focused}`);
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(400);
    ok(`${w}: Esc collapses`, (await pg.evaluate(()=>document.getElementById("header-search").getBoundingClientRect().width))<=42);
    await pg.keyboard.press("Control+k"); await pg.waitForTimeout(300);
    await pg.keyboard.type("fox"); 
    const reqP = pg.waitForRequest(r=>r.url().includes("/api/search")&&r.url().includes("q=fox"),{timeout:8000}).catch(()=>null);
    await pg.keyboard.press("Enter");
    const req = await reqP; await pg.waitForTimeout(600);
    ok(`${w}: Enter runs search for 'fox'`, !!req && (await pg.evaluate(()=>location.hash))==="#search", "");
    const q = await pg.evaluate(()=>[...document.querySelectorAll("input")].map(i=>i.value));
    ok(`${w}: search view shows query`, q.includes("fox"), JSON.stringify(q));
  }
  ok(`${w}: header height ${hh}`, w>=1024? hh<=53 : hh<=57);
  // --- player ---
  await pg.goto(BASE+"/#tv-guide"); await pg.waitForTimeout(1500);
  const play = pg.locator("[data-play-live]:not([disabled])").first();
  if (await play.count()) { await play.click(); await pg.waitForTimeout(3500); }
  const vid = pg.locator("#persistent-player video, video").first();
  ok(`${w}: video present`, (await pg.$$("video")).length>=1);
  const dbg = await pg.evaluate(()=>{const v=document.querySelector("video"); return v?{src:v.currentSrc.slice(-60),rs:v.readyState,err:v.error&&v.error.code,t:v.currentTime,d:v.duration}:null});
  out.push("   video "+JSON.stringify(dbg));
  const hud = pg.locator("[data-testid=player-hud]"), tr = pg.locator("[data-testid=player-transport]");
  ok(`${w}: HUD+transport rendered`, await hud.count()===1 && await tr.count()===1);
  if (await tr.count()) {
    await pg.mouse.move(w/2, 150); await pg.waitForTimeout(700);
    ok(`${w}: visible on mouse move`, (await tr.evaluate(e=>getComputedStyle(e).opacity))==="1");
    await pg.waitForTimeout(3200);
    const playing = await pg.evaluate(()=>{const v=document.querySelector("video");return v&&!v.paused});
    const op = await tr.evaluate(e=>getComputedStyle(e).opacity);
    ok(`${w}: auto-hides after 2.5s while playing`, playing ? op==="0" : true, `playing=${playing} opacity=${op}`);
    await pg.screenshot({path:`/tmp/ui_${w}_hidden.png`});
    await pg.mouse.move(w/2+5, 155); await pg.waitForTimeout(500);
    await pg.screenshot({path:`/tmp/ui_${w}_shown.png`});
    const time = await pg.locator("[data-testid=player-time]").innerText();
    out.push("   time "+time);
    // pause via button
    await pg.getByRole("button",{name:/^Pause$/}).click().catch(()=>{});
    await pg.waitForTimeout(300);
    ok(`${w}: paused → buttons show Play`, await pg.getByRole("button",{name:/^Play$/}).count()>0);
    await pg.waitForTimeout(3000);
    ok(`${w}: stays visible when paused`, (await tr.evaluate(e=>getComputedStyle(e).opacity))==="1");
    // seek
    const before = await pg.evaluate(()=>document.querySelector("video").currentTime);
    const box = await pg.locator("input[aria-label=Seek]").boundingBox();
    if (box && !(await pg.locator("input[aria-label=Seek]").isDisabled())) { await pg.mouse.click(box.x+box.width*0.5, box.y+box.height/2); await pg.waitForTimeout(500);
      const after = await pg.evaluate(()=>document.querySelector("video").currentTime);
      ok(`${w}: scrub seeks to ~middle`, Math.abs(after-30)<5, `${before}->${after}`); }
    // keyboard still works
    await pg.keyboard.press("m"); await pg.waitForTimeout(150);
    const mu = await pg.evaluate(()=>document.querySelector("video").muted);
    out.push("   mute after M: "+mu);
    await pg.keyboard.press("k"); await pg.waitForTimeout(500);
    ok(`${w}: K toggles play`, await pg.evaluate(()=>!document.querySelector("video").paused));
    // volume slider via keyboard on input
    const vol = pg.locator("input[aria-label=Volume]");
    if (w>=640) { await vol.evaluate(el=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; s.call(el,"0.5"); el.dispatchEvent(new Event("input",{bubbles:true}));}); await pg.waitForTimeout(200);
      ok(`${w}: volume slider sets media.volume`, (await pg.evaluate(()=>document.querySelector("video").volume))===0.5); }
    ok(`${w}: PiP button ${await pg.getByRole("button",{name:/Picture-in-Picture/}).count()?"present":"absent (browser-dependent)"}`, true);
    // horizontal scroll
    ok(`${w}: no horizontal page scroll`, await pg.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1), String(await pg.evaluate(()=>document.documentElement.scrollWidth)));
  }
  ok(`${w}: no page errors`, errs.length===0, errs.join("|").slice(0,200));
  await ctx.close();
}
console.log(out.join("\n")); await b.close();
