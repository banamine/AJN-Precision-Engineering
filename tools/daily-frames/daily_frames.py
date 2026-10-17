#!/usr/bin/env python3
"""AJN daily frames: pick still images from today's AJN hourly videos.

Two steps, run on a PC that has ffmpeg + Pillow (pip install pillow):

  1) python tools/daily-frames/daily_frames.py extract [--date YYYYMMDD] [--per-video 12] [--max-videos 6]
       Finds the day's videos in the AJN hourly feed, pulls candidate frames over
       HTTP range requests (no full download), drops black/blurry frames and frames
       that look like ones you rejected before, then writes
       tools/daily-frames/work/<date>/review.html . Open it in a browser, tick the
       frames you want, press "Export decisions" (downloads decisions.json).

  2) python tools/daily-frames/daily_frames.py publish --decisions <path to decisions.json>
       Copies the ticked frames to public/daily/, rewrites public/daily/manifest.json
       (the Home page reads it) and remembers the un-ticked frames as rejects.

Nothing is invented: every manifest entry is a real frame from a real video URL with
its real timestamp. Any failure is printed and counted; exit code is non-zero if a
step produced nothing.
"""
import argparse, hashlib, json, random, re, shutil, subprocess, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image, ImageFilter, ImageStat
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
WORK = HERE / "work"
REJECTS = HERE / "rejected.json"
OUT = REPO / "public" / "daily"
FEED = "https://rss.alexjones.media/AJNHourlyVideo.html"
LINK_RE = re.compile(r'https://archive\.alexjoneslive\.com/hourly-m4v/(\d{8})_([A-Za-z]{3})_(Alex|WarRoom)-Hr(\d+)\.m4v')
UA = "AJN-Precision-Engineering/daily-frames"
EDGE = 120          # skip first/last seconds (intros, outros, bumpers)
MIN_MEAN, MAX_MEAN, MIN_SHARP = 25, 235, 150
HASH_NEAR = 6       # hamming distance that counts as "the same picture you rejected"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def discover(date):
    html = fetch(FEED)
    seen, out = set(), []
    for m in LINK_RE.finditer(html):
        if date and m.group(1) != date:
            continue
        if m.group(0) in seen:
            continue
        seen.add(m.group(0))
        out.append({"url": m.group(0), "date": m.group(1), "show": m.group(3), "hour": int(m.group(4))})
    out.sort(key=lambda v: (v["date"], v["show"], v["hour"]))
    return out


def duration(url):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url],
                       capture_output=True, text=True, timeout=60)
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()[:200]}")


def grab(url, t, dest):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", url, "-frames:v", "1",
                        "-vf", "scale=1280:-2:flags=lanczos", "-q:v", "3", str(dest)],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 2000:
        raise RuntimeError(f"ffmpeg produced no frame at {t:.1f}s: {r.stderr.strip()[:160]}")


def ahash(im):
    small = im.convert("L").resize((8, 8), Image.LANCZOS)
    px = list(small.tobytes())
    avg = sum(px) / 64
    return "".join("1" if p > avg else "0" for p in px)


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def quality(path):
    im = Image.open(path).convert("L")
    mean = ImageStat.Stat(im).mean[0]
    sharp = ImageStat.Stat(im.filter(ImageFilter.FIND_EDGES)).var[0]
    return mean, sharp, ahash(im)


def load_rejects():
    try:
        return json.loads(REJECTS.read_text("utf-8")).get("hashes", [])
    except FileNotFoundError:
        return []


def cmd_extract(a):
    date = a.date or datetime.now(timezone.utc).strftime("%Y%m%d")
    vids = discover(date)
    if not vids:
        sys.exit(f"No videos listed for {date} at {FEED} (feed may not have today's yet; try --date).")
    vids = vids[-a.max_videos:] if a.max_videos else vids
    wdir = WORK / date
    shutil.rmtree(wdir, ignore_errors=True)
    wdir.mkdir(parents=True)
    rejects = load_rejects()
    rng = random.Random(date)  # same day -> same picks; delete work/ and pass --seed to re-roll
    if a.seed is not None:
        rng = random.Random(a.seed)
    cands, errors, dropped = [], [], {"dark_or_bright": 0, "blurry": 0, "rejected_before": 0}
    for v in vids:
        name = f'{v["date"]}_{v["show"]}_Hr{v["hour"]}'
        try:
            dur = duration(v["url"])
        except Exception as e:
            errors.append(f'{name}: {e}'); print("ERROR", name, e); continue
        lo, hi = EDGE, dur - EDGE
        if hi <= lo:
            errors.append(f"{name}: too short ({dur:.0f}s)"); continue
        n = a.per_video
        slot = (hi - lo) / n
        got = 0
        for i in range(n):
            t = lo + slot * i + rng.uniform(0.1, 0.9) * slot  # one jittered pick per slot = even spread
            f = wdir / f"{name}_{int(t):05d}.jpg"
            try:
                grab(v["url"], t, f)
                mean, sharp, h = quality(f)
            except Exception as e:
                errors.append(f"{name}@{t:.0f}s: {e}"); print("ERROR", name, f"{t:.0f}s", e); f.unlink(missing_ok=True); continue
            if mean < MIN_MEAN or mean > MAX_MEAN:
                dropped["dark_or_bright"] += 1; f.unlink(); continue
            if sharp < MIN_SHARP:
                dropped["blurry"] += 1; f.unlink(); continue
            if any(hamming(h, r) <= HASH_NEAR for r in rejects):
                dropped["rejected_before"] += 1; f.unlink(); continue
            got += 1
            cands.append({"file": f.name, "video": v["url"], "show": v["show"], "hour": v["hour"],
                          "t": round(t, 1), "hash": h, "mean": round(mean), "sharp": round(sharp)})
        print(f"{name}: {got}/{n} kept")
    if not cands:
        sys.exit(f"No usable frames. errors={len(errors)} dropped={dropped}")
    (wdir / "candidates.json").write_text(json.dumps({"date": date, "candidates": cands, "errors": errors, "dropped": dropped}, indent=1))
    (wdir / "review.html").write_text(review_html(date, cands, errors, dropped), "utf-8")
    print(f"\n{len(cands)} candidates, {len(errors)} errors, dropped {dropped}\nOpen: {wdir / 'review.html'}")
    if errors:
        sys.exit(2 if len(errors) == len(vids) else 0)


def review_html(date, cands, errors, dropped):
    data = json.dumps(cands)
    err = "".join(f"<li>{e.replace('<','&lt;')}</li>" for e in errors)
    return f"""<!doctype html><meta charset=utf-8><title>AJN daily frames {date}</title>
<style>body{{background:#0a0a0a;color:#ddd;font:14px system-ui;margin:16px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}}
.c{{border:3px solid #333;border-radius:8px;overflow:hidden;cursor:pointer;background:#111}}
.c.on{{border-color:#22c55e}} .c img{{width:100%;display:block}} .c p{{margin:0;padding:4px 8px;font-size:12px;color:#999}}
button{{background:#0ea5e9;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}}
.bar{{position:sticky;top:0;background:#0a0a0acc;padding:8px 0;z-index:2}}</style>
<div class=bar><b>AJN daily frames {date}</b> &nbsp; click a frame to keep it (green). <span id=n>0</span> kept &nbsp;
<button onclick=exp()>Export decisions</button> &nbsp; <small>dropped: {dropped}</small></div>
{('<details open><summary>Errors ('+str(len(errors))+')</summary><ul>'+err+'</ul></details>') if errors else ''}
<div class=g id=g></div>
<script>const D={data},K=new Set(),g=document.getElementById('g');
D.forEach((c,i)=>{{const d=document.createElement('div');d.className='c';
d.innerHTML=`<img loading=lazy src="${{c.file}}"><p>${{c.show}} Hr${{c.hour}} @ ${{Math.floor(c.t/60)}}:${{String(Math.floor(c.t%60)).padStart(2,'0')}}</p>`;
d.onclick=()=>{{K.has(i)?K.delete(i):K.add(i);d.classList.toggle('on');document.getElementById('n').textContent=K.size}};g.appendChild(d)}});
function exp(){{const out={{date:"{date}",keep:D.filter((_,i)=>K.has(i)),reject:D.filter((_,i)=>!K.has(i)).map(c=>c.hash)}};
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{{type:'application/json'}}));a.download='decisions.json';a.click()}}
</script>"""


def cmd_publish(a):
    dec = json.loads(Path(a.decisions).read_text("utf-8"))
    date = dec["date"]
    keep = dec.get("keep", [])
    if not keep:
        sys.exit("decisions.json keeps no frames; nothing published (manifest left as is).")
    wdir = WORK / date
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.jpg"):
        old.unlink()
    items = []
    for c in keep:
        src = wdir / c["file"]
        if not src.exists():
            sys.exit(f"Missing work file {src}; re-run extract for {date}.")
        im = Image.open(src).convert("RGB")
        w = im.width
        name = hashlib.sha1((c["video"] + str(c["t"])).encode()).hexdigest()[:10] + ".jpg"
        im.save(OUT / name, "JPEG", quality=84, optimize=True)
        if not (OUT / name).exists() or (OUT / name).stat().st_size < 2000:
            sys.exit(f"Failed to write {name}")
        items.append({"image": f"/daily/{name}", "width": w, "height": im.height, "show": "Alex Jones Show" if c["show"] == "Alex" else "War Room",
                      "hour": c["hour"], "source": c["video"], "timestamp": c["t"]})
    manifest = {"date": f"{date[:4]}-{date[4:6]}-{date[6:]}", "generatedAt": datetime.now(timezone.utc).isoformat(), "items": items}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), "utf-8")
    hashes = sorted(set(load_rejects()) | set(dec.get("reject", [])))[-500:]
    REJECTS.write_text(json.dumps({"hashes": hashes}, indent=0), "utf-8")
    print(f"Published {len(items)} frames to {OUT}; {len(hashes)} reject fingerprints remembered.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    e = s.add_parser("extract"); e.add_argument("--date"); e.add_argument("--per-video", type=int, default=12)
    e.add_argument("--max-videos", type=int, default=6); e.add_argument("--seed", type=int)
    q = s.add_parser("publish"); q.add_argument("--decisions", required=True)
    a = p.parse_args()
    {"extract": cmd_extract, "publish": cmd_publish}[a.cmd](a)


if __name__ == "__main__":
    main()
