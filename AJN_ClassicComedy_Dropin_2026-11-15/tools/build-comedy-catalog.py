#!/usr/bin/env python3
"""Build src/data/classicComedyCatalog.json (offline; no invented durations).
Inputs: src/data/showEpisodes/<show>.json (real Archive file lengths, from the Shows drop-in) and
tools/comedy-sources/edith377-green-acres.json. Run from the repo root: python tools/build-comedy-catalog.py"""
import hashlib, json, os, re, sys
SHOWS = ["the-super-dave-osborne-show", "all-in-the-family", "parker-lewis-can-t-lose", "home-improvement",
  "still-standing", "f-troop", "less-than-perfect", "veronica-s-closet", "for-your-love", "ned-and-stacey", "malcolm-in-the-middle",
  "day-by-day", "the-jeff-foxworthy-show", "archie-bunker-s-place"]
def se(t):
    m = re.search(r"(\d{1,2})[ .x-]+(\d{1,3})\s*$", t)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)
assets = []
for spec in SHOWS:
    slug = fname = spec
    p = f"src/data/showEpisodes/{fname}.json"
    for i, e in enumerate(json.load(open(p, encoding="utf-8"))):
        if not e.get("d") or e["d"] < 300: continue
        s, n = se(e["t"]); ek = f"{slug}:{e['p']}"
        a = {"episodeKey": ek, "assetId": "xc-" + hashlib.sha1(ek.encode()).hexdigest()[:14], "show": slug, "title": e["t"],
             "archivePath": e["p"], "durationSeconds": int(e["d"]), "sources": ["comedy"]}
        if s is not None: a.update(season=s, episode=n)
        assets.append(a)
for r in json.load(open("tools/comedy-sources/edith377-green-acres.json", encoding="utf-8"))["rows"]:
    ek = f"green-acres:{r['identifier']}:{r['file']}"
    from urllib.parse import quote
    assets.append({"episodeKey": ek, "assetId": "xc-" + hashlib.sha1(ek.encode()).hexdigest()[:14], "show": "green-acres",
        "title": f"Green Acres - {r['title']}", "archivePath": "/download/" + quote(r["identifier"]) + "/" + quote(r["file"]),
        "durationSeconds": r["seconds"], "season": r["season"], "episode": r["episode"], "sources": ["comedy"]})
assets.sort(key=lambda a: (a["show"], a.get("season", 99), a.get("episode", 999), a["title"]))
json.dump({"schema": 1, "assets": assets}, open("src/data/classicComedyCatalog.json", "w"), indent=1)
per = {}
for a in assets: x = per.setdefault(a["show"], [0, 0]); x[0] += 1; x[1] += a["durationSeconds"]
for k, (n, s) in sorted(per.items(), key=lambda kv: -kv[1][1]): print(f"{k:28s}{n:4d} eps {s/3600:6.1f} h  mean {s/n/60:5.1f} min")
print("assets", len(assets), "hours", round(sum(v[1] for v in per.values())/3600, 1))
