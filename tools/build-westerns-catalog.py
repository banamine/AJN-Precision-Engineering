#!/usr/bin/env python3
"""Build src/data/classicWesternsCatalog.json from Archive.org item metadata (real file durations).

Run from the repo root:  python tools/build-westerns-catalog.py
Polite: one metadata request per item, 1 s apart. No invented data: files without a real
`length` or marked restricted are excluded and written to reports/classic-network/classicWesternsCatalog-exclusions.json.
"""
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request

# show slug -> (display name, [archive items], filename regex or None, in24x7)
SHOWS = {
  "wagon-train":        ("Wagon Train", ["wagon-train-s-01-e-101-ep-101-the-willy-moran-story"], None, True),
  "gunsmoke":           ("Gunsmoke", ["gunsmoke-s-16-e-01-the-noose"], None, True),
  "tales-of-wells-fargo": ("Tales of Wells Fargo", ["tales-of-wells-fargo-s-06-e-30-royal-maroon"], None, True),
  "rawhide":            ("Rawhide", ["rawhide-3-x-30-incident-of-the-wager-on-payday"], r"rawhide", True),
  "maverick":           ("Maverick", ["s-01e-02.-point-blank"], None, True),
  "wanted-dead-or-alive": ("Wanted Dead or Alive", ["wanted-dead-or-alive-s-01-e-01-ep-1-the-martin-poster"], None, True),
  "branded":            ("Branded", ["branded-s-02-e-22-barbed-wire_202405"], None, True),
  "lawman":             ("Lawman", ["lawman-s-03-e-24-detweilers-kid", "lawman-s-01-e-01-the-deputy"], None, True),
  "bat-masterson":      ("Bat Masterson", ["bat-masterson-s-02-e-07-dead-men-dont-pay-debts"], None, True),
  "the-wild-wild-west": ("The Wild Wild West", ["01-tv-fighting-crime"], r"wild.?wild.?west", True),
}
TVW = "01-tv-westerns-part-2-classical-western-theme-music-by-ennio-morricone-sergio-leones-boyhood-friend"
SHOWS.update({
  "the-virginian":        ("The Virginian", [TVW], r"virginian", True),
  "have-gun-will-travel": ("Have Gun Will Travel", [TVW], r"have.?gun", True),
  "the-texan":            ("The Texan", [TVW], r"(^|/)the.?texan", False),
})
UA = {"User-Agent": "Mozilla/5.0"}

def meta(item):
    req = urllib.request.Request("https://archive.org/metadata/" + urllib.parse.quote(item), headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)

def season_ep(name):
    for pat in (r"[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})", r"[Ss]-?(\d{1,2})[ ._-]*EP?[ ._-]*(\d{1,3})", r"(\d{1,2})x(\d{1,3})"):
        m = re.search(pat, name)
        if m: return int(m.group(1)), int(m.group(2))
    return None, None

def clean_title(name):
    t = os.path.splitext(os.path.basename(name))[0]
    t = re.sub(r"\.ia$", "", t)
    return re.sub(r"\s+", " ", re.sub(r"[_.]+", " ", t)).strip()

def main():
    assets, excluded, cache = [], [], {}
    for slug, (display, items, rx, _) in SHOWS.items():
        seen = set()
        for item in items:
            if item not in cache:
                time.sleep(1)
                cache[item] = meta(item)
            m = cache[item]
            if m.get("is_dark") or m.get("metadata", {}).get("access-restricted-item") == "true":
                excluded.append({"show": slug, "item": item, "reason": "restricted_or_dark"}); continue
            files = {f["name"]: f for f in m.get("files", [])}
            for name, f in sorted(files.items()):
                if not name.lower().endswith(".mp4"): continue
                if rx and not re.search(rx, name, re.I): continue
                if re.search(r"(trailer|sample)", name, re.I): continue
                if name.lower().endswith(".ia.mp4") and (name[:-7] + ".mp4") in files: continue  # plain twin is primary
                try: dur = float(f.get("length", ""))
                except ValueError: dur = 0
                if dur < 300:
                    excluded.append({"show": slug, "item": item, "file": name, "reason": "missing_or_short_duration"}); continue
                s, e = season_ep(name)
                key = ("se", s, e) if s is not None else ("f", clean_title(name).lower())
                if key in seen:
                    excluded.append({"show": slug, "item": item, "file": name, "reason": "duplicate_episode"}); continue
                seen.add(key)
                ek = f"{slug}:{item}:{name}"
                assets.append({
                    "episodeKey": ek,
                    "assetId": "xw-" + hashlib.sha1(ek.encode()).hexdigest()[:14],
                    "show": slug,
                    "title": clean_title(name),
                    "archivePath": "/download/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(name),
                    "durationSeconds": int(round(dur)),
                    **({"season": s, "episode": e} if s is not None else {}),
                    "sources": ["westerns"],
                })
    assets.sort(key=lambda a: (a["show"], a.get("season", 99), a.get("episode", 999), a["title"]))
    os.makedirs("reports/classic-network", exist_ok=True)
    json.dump({"schema": 1, "assets": assets}, open("src/data/classicWesternsCatalog.json", "w"), indent=2)
    json.dump({"excluded": excluded}, open("reports/classic-network/classicWesternsCatalog-exclusions.json", "w"), indent=2)
    per = {}
    for a in assets:
        per.setdefault(a["show"], [0, 0]); per[a["show"]][0] += 1; per[a["show"]][1] += a["durationSeconds"]
    for k, (n, s) in per.items(): print(f"{k:24s} {n:4d} eps  {s/3600:7.1f} h  mean {s/n/60:5.1f} min")
    print("excluded", len(excluded), "total assets", len(assets))

if __name__ == "__main__":
    sys.exit(main())
