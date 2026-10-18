#!/usr/bin/env python3
"""Add the @boris1971 uploads on page 6 of https://archive.org/details/@boris1971?page=6&and[]=mediatype:"movies" (20 items, 2026-10-17)
to src/data/extraChannelsManifest.json as GENRE channels of the movies-classics-vault guide (additive; re-running replaces only these channels).
Admission: real runtime and size from item metadata, h.264 .mp4 derivative only (never the .mkv), no private/dark files.
Usage: python tools/add-boris1971-genre-channels.py --meta /tmp/boris_meta.json   (meta = {identifier: archive.org/metadata/<id> JSON})"""
import argparse, hashlib, json, os, re
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS = [  # (channel id, name, [identifiers in play order])
  ("mx-genre-horror-monsters", "Horror & Monster Movies", ["the-vampire-and-the-ballerina-1960_202511", "king-of-the-zombies-1941_202510", "night-of-the-blood-beast-1958_202511", "cry-of-the-werewolf-1944_202509", "the-vampire-bat-1933-b-w", "matango-1963-english-dub", "the-mighty-peking-man-1977_202506"]),
  ("mx-genre-scifi-superhero", "Sci-Fi & Superhero", ["the-atomic-submarine-1959_202508", "power-pack-tv-pilot"]),
  ("mx-genre-mystery-crime", "Mystery & Crime", ["the-bat-1959_202504", "baffled-1972", "the-saint-in-manhattan-1987", "menace-unseen-mini-series-1988"]),
  ("mx-genre-action-adventure-western", "Action, Adventure & Western", ["duncan-jax-duology-1986", "extreme-ops-2002_202511", "the-legend-of-the-golden-gun-1979_202511"]),
  ("mx-genre-documentaries", "Documentaries: Mysteries & Monsters", ["Man-beast-myth-or-monster-1978", "from-earth-to-the-moon-making-of-ufo-documentary", "in-search-of-noahs-ark-documentaries-1976"]),
  ("mx-genre-british-comedy", "British Comedy", ["yanks-go-home-1976"]),
]
SKIP_FILE = re.compile(r"colou?r", re.I)  # The Vampire Bat: keep the original B&W, not the colourised copy of the same film
def tidy_title(t):
    t = re.sub(r"\s+", " ", (t or "").replace("_", " ")).strip(" -.")
    return re.sub(r"\s(\d{4})$", r" (\1)", t)
def rows_for(ident, meta):
    m = meta[ident]; md = m["metadata"]
    if m.get("is_dark") or md.get("access-restricted-item") == "true": return []
    vids = [f for f in m["files"] if f["name"].lower().endswith(".mp4") and ".thumbs/" not in f["name"] and f.get("private") != "true" and f.get("format") == "h.264" and float(f.get("length") or 0) >= 600]
    vids = [f for f in vids if not SKIP_FILE.search(f["name"])] or vids
    vids.sort(key=lambda f: re.sub(r"(\d+)", lambda x: x.group(1).zfill(6), f["name"]))
    out = []
    for f in vids:
        stem = f["name"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
        title = tidy_title(md.get("title")) if len(vids) == 1 else tidy_title(stem)
        out.append({"id": "xc-" + hashlib.md5(f"{ident}/{f['name']}".encode()).hexdigest()[:14], "identifier": ident, "file": f["name"], "title": title, "bytes": int(f["size"]), "durationSeconds": round(float(f["length"])), "thumb": "__ia_thumb.jpg"})
    return out
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--meta", required=True); a = ap.parse_args()
    meta = json.load(open(a.meta)); p = os.path.join(root, "src/data/extraChannelsManifest.json"); d = json.load(open(p))
    ids = {c[0] for c in CHANNELS}; d["channels"] = [c for c in d["channels"] if c["id"] not in ids]
    for cid, name, idents in CHANNELS:
        rows = [r for i in idents for r in rows_for(i, meta)]
        assert rows, cid
        d["channels"].append({"guideId": "movies-classics-vault", "id": cid, "name": name, "group": "Movies", "rows": rows})
        print(f"{cid}: {len(rows)} rows, {sum(r['durationSeconds'] for r in rows)/3600:.1f} h")
    json.dump(d, open(p, "w"), separators=(",", ":"), ensure_ascii=False)
main()
