// Whole-site health sweep (no browser needed). Run on YOUR computer against the live app:
//   node tools/site-sweep.mjs --url https://<your-app>            (default: 12 sampled media links per guide)
//   node tools/site-sweep.mjs --url https://<your-app> --sample 40 --out sweep.json
//   node tools/site-sweep.mjs --url https://<your-app> --perf      (size report only: raw vs wire size per guide + heaviest fields)
// Checks: API health, every guide's schedule (speed, size, empty/duplicate channels, bad programs), REAL media links
// (a 1-byte Range request through the live proxy for sampled programs, expects 206), search, news, library, audio cover art,
// unknown-API behaviour, and SSRF/path guards on the proxies. Read-only: it only issues GET requests.
import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const BASE = String(arg("url", "")).replace(/\/$/, "");
if (!/^https?:\/\/[^/]+\.[^/]+|^https?:\/\/localhost/i.test(BASE) || /YOUR-APP|PASTE/i.test(BASE)) { console.error("Give the real app address: node tools/site-sweep.mjs --url https://your-real-address"); process.exit(2); }
const SAMPLE = Number(arg("sample", 12)), OUT = arg("out", "site-sweep-report.json");
const R = []; const rec = (id, pass, ev) => { R.push({ id, result: pass === null ? "INFO" : pass ? "PASS" : "FAIL", evidence: ev }); console.log(`${pass === null ? "INFO" : pass ? "PASS" : "FAIL"}  ${id}  ${typeof ev === "string" ? ev : JSON.stringify(ev)}`.slice(0, 400)); };
const get = async (path, opt = {}) => { const t = Date.now(); try { const r = await fetch(BASE + path, { signal: AbortSignal.timeout(opt.timeout ?? 45000), ...opt }); return { r, ms: Date.now() - t }; } catch (e) { return { err: String(e?.cause?.code || e?.message || e), ms: Date.now() - t }; } };
const json = async (x) => { try { return await x.r.json(); } catch { return null; } };
const pool = async (items, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; };


// ---- --perf: payload size report (raw vs compressed on the wire, and which fields cost the most) ----
if (process.argv.includes("--perf")) {
  const zlib = await import("node:zlib"); const mod = BASE.startsWith("https") ? await import("node:https") : await import("node:http");
  const wire = (path) => new Promise((resolve) => { const t0 = Date.now(); let ttfb = 0;
    const req = mod.request(BASE + path, { headers: { "Accept-Encoding": "gzip" }, timeout: 60000 }, (res) => { ttfb = Date.now() - t0; const chunks = []; let n = 0;
      res.on("data", (c) => { chunks.push(c); n += c.length; });
      res.on("end", () => { const buf = Buffer.concat(chunks); const enc = res.headers["content-encoding"] || "none"; let raw = buf; try { if (enc === "gzip") raw = zlib.gunzipSync(buf); else if (enc === "br") raw = zlib.brotliDecompressSync(buf); } catch {}
        resolve({ status: res.statusCode, enc, wireBytes: n, rawBytes: raw.length, ttfb, total: Date.now() - t0, body: raw.toString("utf8") }); }); });
    req.on("error", (e) => resolve({ err: e.message })); req.on("timeout", () => { req.destroy(); resolve({ err: "timeout" }); }); req.end(); });
  const g2 = await wire("/api/guides"); const gl = (JSON.parse(g2.body || "{}").guides || []).map((x) => x.id);
  const MB = (n) => +(n / 1048576).toFixed(2), KB = (n) => Math.round(n / 1024);
  const out = []; console.log(`Perf report for ${BASE}  (wire = bytes actually sent with Accept-Encoding: gzip)\n`);
  for (const id of gl) {
    const w = await wire(`/api/schedule?guide=${encodeURIComponent(id)}`); if (w.err || w.status !== 200) { console.log(id, "ERROR", w.err || w.status); continue; }
    const d = JSON.parse(w.body); const chs = d.channels || []; const progs = chs.flatMap((c) => c.programs || []);
    const fields = {}; const add = (k, v) => { const f = (fields[k] ||= { raw: 0, vals: [] }); const j = JSON.stringify(v); if (j === undefined) return; f.raw += j.length + k.length + 4; f.vals.push(j); };
    for (const p of progs) for (const [k, v] of Object.entries(p)) { if (k === "metadata" && v && typeof v === "object") { for (const [mk, mv] of Object.entries(v)) add("metadata." + mk, mv); } else add(k, v); }
    const rows = Object.entries(fields).map(([k, f]) => ({ field: k, rawKB: KB(f.raw), gzipKB: KB(zlib.gzipSync(f.vals.join("\n")).length), pctRaw: +(100 * f.raw / w.rawBytes).toFixed(1), present: f.vals.length })).sort((a, b) => b.rawKB - a.rawKB);
    const dupDesc = (() => { const m = new Map(); for (const p of progs) if (p.description) m.set(p.description, (m.get(p.description) || 0) + 1); let wasted = 0; for (const [k, n] of m) if (n > 1) wasted += k.length * (n - 1); return KB(wasted); })();
    const res = { guide: id, channels: chs.length, programs: progs.length, status: w.status, encoding: w.enc, rawMB: MB(w.rawBytes), wireMB: MB(w.wireBytes), ratio: +(w.rawBytes / Math.max(1, w.wireBytes)).toFixed(1), ttfbMs: w.ttfb, totalMs: w.total, bytesPerProgram: progs.length ? Math.round(w.rawBytes / progs.length) : 0, duplicatedDescriptionKB: dupDesc, topFields: rows.slice(0, 8) };
    out.push(res);
    console.log(`${id.padEnd(24)} ${String(progs.length).padStart(6)} programs  raw ${String(res.rawMB).padStart(6)} MB  wire ${String(res.wireMB).padStart(5)} MB (${w.enc}, x${res.ratio})  ttfb ${w.ttfb} ms  total ${w.total} ms  ${res.bytesPerProgram} B/program`);
    for (const r of rows.slice(0, 6)) console.log(`      ${r.field.padEnd(28)} ${String(r.rawKB).padStart(6)} KB raw  ${String(r.gzipKB).padStart(5)} KB gz  ${String(r.pctRaw).padStart(5)}%  (${r.present} rows)`);
    if (dupDesc > 50) console.log(`      repeated descriptions waste ~${dupDesc} KB raw`);
  }
  const rep = { base: BASE, at: new Date().toISOString(), guides: out }; fs.writeFileSync(arg("out", "site-perf-report.json"), JSON.stringify(rep, null, 2));
  console.log(`\nReport: ${arg("out", "site-perf-report.json")}`); process.exit(0);
}

// 1. health
{ const x = await get("/api/health"); const j = x.r && await json(x); rec("API health", !!x.r?.ok && j?.status === "ok", { status: x.r?.status ?? x.err, ms: x.ms }); }

// 2. guides + schedules
const g = await get("/api/guides"); const guides = ((g.r && (await json(g))?.guides) || []);
rec("guides listed", guides.length > 0, guides.map((x) => x.id));
const programsByGuide = {};
for (const gd of guides) {
  const x = await get(`/api/schedule?guide=${encodeURIComponent(gd.id)}`, { headers: { "Accept-Encoding": "gzip" } });
  if (!x.r?.ok) { rec(`schedule ${gd.id}`, false, { status: x.r?.status ?? x.err, ms: x.ms }); continue; }
  const text = await x.r.text(); const d = JSON.parse(text); const ch = d.channels || [];
  const empty = ch.filter((c) => !c.programs?.length).map((c) => c.id);
  const idSeen = new Set(), dupCh = [];
  for (const c of ch) { if (idSeen.has(c.id)) dupCh.push(c.id); idSeen.add(c.id); }
  let noMedia = 0, dupProg = 0, badTime = 0, total = 0; const all = [];
  for (const c of ch) { const seen = new Set(); for (const p of c.programs || []) { total++; if (!p.mediaUrl && !p.archivePath) noMedia++; if (seen.has(p.id)) dupProg++; seen.add(p.id);
    if (p.endTimeUtc && p.startTimeUtc && !(Date.parse(p.endTimeUtc) > Date.parse(p.startTimeUtc))) badTime++; all.push({ ...p, _ch: c.name, _chId: c.id }); } }
  programsByGuide[gd.id] = all;
  const wireKB = Number(x.r.headers.get("content-length")) / 1024 || null;
  rec(`schedule ${gd.id}: loads (<10 s) with channels`, ch.length > 0 && x.ms < 10000, { ms: x.ms, channels: ch.length, programs: total, rawMB: +(text.length / 1048576).toFixed(2), wireKB: wireKB && Math.round(wireKB), encoding: x.r.headers.get("content-encoding") });
  rec(`schedule ${gd.id}: integrity (no empty/duplicate channels, no media-less or reversed-time programs)`, !empty.length && !dupCh.length && !noMedia && !badTime, { emptyChannels: empty.slice(0, 8), duplicateChannelIds: dupCh.slice(0, 5), programsWithoutMedia: noMedia, duplicateProgramIds: dupProg, reversedTimes: badTime });
}

// 3. REAL media links through the live proxy (1-byte range)
for (const [gid, progs] of Object.entries(programsByGuide)) {
  const prox = progs.filter((p) => (p.mediaUrl || "").startsWith("/api/archive/proxy") || (p.mediaUrl || "").startsWith("/api/ajn/proxy"));
  if (!prox.length) { rec(`media links ${gid}`, null, `no proxied programs (live/HLS/embeds: ${progs.length}) — test by hand`); continue; }
  const stride = Math.max(1, Math.floor(prox.length / SAMPLE)); const pick = []; for (let i = 0; i < prox.length && pick.length < SAMPLE; i += stride) pick.push(prox[i]);
  const res = await pool(pick, 4, async (p) => { const x = await get(p.mediaUrl, { headers: { Range: "bytes=0-1" }, timeout: 60000 });
    const ct = x.r?.headers.get("content-type") || ""; const okc = x.r && (x.r.status === 206 || x.r.status === 200) && /^(video|audio)\//.test(ct) && (x.r.status !== 206 || !!x.r.headers.get("content-range"));
    let why = ""; if (x.r && !okc) { try { const b = await x.r.text(); why = b.slice(0, 120); } catch {} } else { try { await x.r?.body?.cancel(); } catch {} }
    return { ok: !!okc, ch: p._ch, title: String(p.title).slice(0, 60), status: x.r?.status ?? x.err, ct, ms: x.ms, why }; });
  const bad = res.filter((r) => !r.ok); const slow = res.filter((r) => r.ms > 8000).length;
  rec(`media links ${gid}: ${res.length - bad.length}/${res.length} playable (1-byte range via proxy)`, bad.length === 0, { failures: bad.slice(0, 6), slowOver8s: slow, medianMs: res.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(res.length / 2)] });
}

// 4. search
for (const q of ["news", "documentary", "tucker"]) { const x = await get(`/api/search?q=${encodeURIComponent(q)}`); const j = x.r && await json(x);
  rec(`search "${q}"`, !!x.r?.ok && j?.status === "ok" && (j.items?.length ?? 0) > 0 && !!j.items[0].identifier && !!j.items[0].title, { status: x.r?.status ?? x.err, ms: x.ms, total: j?.total, returned: j?.items?.length, first: j?.items?.[0]?.title }); }

// 5. news / digest / rush / library / playlists
{ const x = await get("/api/news/version"); const j = x.r && await json(x); rec("news version", !!x.r?.ok && !!j?.fetchedAt, { fetchedAt: j?.fetchedAt, ageHours: j?.fetchedAt ? +((Date.now() - Date.parse(j.fetchedAt)) / 36e5).toFixed(1) : null, newShows: j?.newShows?.length }); }
{ const x = await get("/api/digest"); const j = x.r && await json(x); rec("daily news digest (503 is an honest 'not loaded' state)", x.r?.status === 200 ? true : null, { status: x.r?.status ?? x.err, state: j?.status, error: j?.error, keys: j ? Object.keys(j).slice(0, 8) : null }); }
{ const x = await get("/api/rush/index"); const j = x.r && await json(x); rec("rush index", !!x.r?.ok && (Array.isArray(j) ? j.length : (j?.items?.length ?? j?.total ?? 0)) > 0, { status: x.r?.status ?? x.err, size: Array.isArray(j) ? j.length : Object.keys(j || {}).slice(0, 5) }); }
{ const x = await get("/api/library/items?category=news"); const j = x.r && await json(x); rec("library items (news)", !!x.r?.ok, { status: x.r?.status ?? x.err, count: j?.items?.length ?? j?.total }); }
{ const x = await get("/api/playlists"); const j = x.r && await json(x); rec("playlists", !!x.r?.ok && (j?.total ?? 0) > 0, { status: x.r?.status ?? x.err, total: j?.total }); }

// 6. audio cover art
{ const audio = Object.values(programsByGuide).flat().find((p) => p.mediaType === "audio" && /^\/download\//.test(p.archivePath || ""));
  if (!audio) rec("audio cover art lookup", null, "no audio program with an /download/ path found");
  else { const x = await get(`/api/archive/folder-art?path=${encodeURIComponent(audio.archivePath)}`); const j = x.r && await json(x);
    rec("audio cover art lookup (200 + images[] — empty is valid, 404 means the new route is not deployed)", !!x.r?.ok && Array.isArray(j?.images), { status: x.r?.status ?? x.err, ms: x.ms, images: j?.images?.length, track: String(audio.title).slice(0, 50) }); } }

// 7. unknown API must not be a 200 web page; guards
{ const x = await get("/api/does-not-exist-xyz"); const ct = x.r?.headers.get("content-type") || ""; rec("unknown /api/* is a 404, not a 200 HTML page", x.r?.status === 404 && !/html/.test(ct), { status: x.r?.status ?? x.err, contentType: ct }); }
for (const [name, path, want] of [
  ["proxy rejects file path", "/api/archive/proxy?path=%2Fetc%2Fpasswd", [400, 403, 404]],
  ["proxy rejects embedded host", "/api/archive/proxy?path=http%3A%2F%2F169.254.169.254%2Flatest", [400, 403]],
  ["proxy rejects traversal", "/api/archive/proxy?path=%2Fdownload%2Fx%2F..%2F..%2Fetc%2Fpasswd", [400, 403, 404]],
  ["ajn proxy rejects non-allowlisted host", "/api/ajn/proxy?url=http%3A%2F%2F127.0.0.1%3A22%2F", [400, 403]],
  ["hls playlist proxy rejects non-allowlisted host", "/api/hls/playlist?url=https%3A%2F%2Fexample.com%2Fa.m3u8", [400, 403]],
]) { const x = await get(path); rec(`guard: ${name}`, !!x.r && want.includes(x.r.status), { status: x.r?.status ?? x.err }); }

fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results: R }, null, 2));
console.log(`\nReport: ${OUT}  (${R.filter((r) => r.result === "FAIL").length} FAIL, ${R.filter((r) => r.result === "PASS").length} PASS, ${R.filter((r) => r.result === "INFO").length} info)`);
process.exit(R.some((r) => r.result === "FAIL") ? 1 : 0);
