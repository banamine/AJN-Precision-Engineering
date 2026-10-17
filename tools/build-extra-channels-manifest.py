#!/usr/bin/env python3
"""Build src/data/extraChannelsManifest.json (user request 2026-10-08).
Cable TV guide : INFOWARS NIGHTLY NEWS (Alex 24 playlist), INFO WARS SURVIVAL (Info Survior playlist)
Movies guide   : Lars Germany Mittank / JT's Ghost / AIVIIXX uploads, Random Movies (item 36857), Star Wars (item a7c4f92b...)
Same admission rules as build-organizer-manifest.py (real runtime from item metadata, no dark/private/missing files, .ia.mp4 preferred,
no 30 s / 100 KB placeholders, one row per playable file).
Usage: python tools/build-extra-channels-manifest.py --cache DIR [--accounts DIR] [--fetch]
  DIR/playlists/Mixed/{Alex 24.m3u,Info Survior.m3u}, DIR/meta/*.json (fetched when --fetch)
  accounts DIR/<account>.items.json = uploads list from archive.org/services/search/beta/page_production (account_details)
"""
import argparse, hashlib, importlib.util, json, os, random, re, unicodedata

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("org", os.path.join(here, "build-organizer-manifest.py"))
org = importlib.util.module_from_spec(spec); spec.loader.exec_module(org)

EMOJI = re.compile("[\U0001F000-\U0001FFFF☀-➿️‍]")
def tidy(t):
    t = EMOJI.sub("", unicodedata.normalize("NFKC", t or ""))
    return re.sub(r"\s+", " ", t.replace("_", " ")).strip(" -.")

def row(ident, pick, it, title):
    return {"id": "xc-" + hashlib.md5(f"{ident}/{pick['name']}".encode()).hexdigest()[:14], "identifier": it["id"], "file": pick["name"],
            "title": title, "bytes": pick["size"], "durationSeconds": round(pick["len"]), "thumb": it["thumb"]}

def playlist_rows(path, meta):
    rows, seen, dropped = [], set(), {}
    for e in org.parse_playlist(path):
        sp = org.split_ia(e["url"])
        if not sp: dropped["external"] = dropped.get("external", 0) + 1; continue
        st, pick, kind, it = org.resolve(sp[0], sp[1], meta)
        if st != "ok" or kind != "video": dropped[st if st != "ok" else "audio"] = dropped.get(st if st != "ok" else "audio", 0) + 1; continue
        k = (it["id"].lower(), pick["name"].lower())
        if k in seen: dropped["duplicate"] = dropped.get("duplicate", 0) + 1; continue
        seen.add(k); rows.append(row(sp[0], pick, it, org.clean_title(e["title"], sp[1])))
    return rows, dropped

def item_rows(idents, meta, order=None, min_len=0, only_derivative=False, namer=None):
    rows, seen, lens, dropped = [], set(), set(), {}
    for ident, item_title in idents:
        it = meta.get(ident)
        if not it or it["state"] != "ok": dropped["dark"] = dropped.get("dark", 0) + 1; continue
        cands = []
        for f in sorted(it["files"].values(), key=lambda x: org.natural(x["name"])):
            ext = f["name"].rsplit(".", 1)[-1].lower() if "." in f["name"] else ""
            if ext not in org.VIDEO_EXT: continue
            st, pick, kind, _ = org.resolve(ident, f["name"], meta)
            if st != "ok" or kind != "video": dropped[st] = dropped.get(st, 0) + 1; continue
            if pick["len"] < min_len: dropped["too_short"] = dropped.get("too_short", 0) + 1; continue
            k = (it["id"].lower(), pick["name"].lower())
            lk = (it["id"].lower(), round(pick["len"]), pick["size"] // 1_000_000)
            if k in seen or lk in lens: dropped["duplicate"] = dropped.get("duplicate", 0) + 1; continue
            seen.add(k); lens.add(lk); cands.append((f, pick))
        for f, pick in cands:
            title = namer(f, pick, item_title) if namer else (tidy(item_title) if len(cands) == 1 else tidy(f["name"].rsplit("/", 1)[-1].rsplit(".", 1)[0]))
            rows.append(row(ident, pick, it, title))
    return rows, dropped

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache", required=True); ap.add_argument("--accounts", default="/tmp/mv")
    ap.add_argument("--fetch", action="store_true"); ap.add_argument("--out", default="src/data/extraChannelsManifest.json")
    ap.add_argument("--report", default="reports/extra-channels.json"); a = ap.parse_args()
    meta = org.Meta(a.cache, a.fetch)
    chans, report = [], {}
    def add(guide, cid, name, group, rows, dropped, note=""):
        chans.append({"guideId": guide, "id": cid, "name": name, "group": group, "rows": rows})
        report[cid] = {"name": name, "guide": guide, "rows": len(rows), "hours": round(sum(r["durationSeconds"] for r in rows) / 3600), "dropped": dropped, "note": note}

    mixed = os.path.join(a.cache, "playlists", "Mixed")
    r, d = playlist_rows(os.path.join(mixed, "Alex 24.m3u"), meta)
    add("cable-tv", "ajn-infowars-nightly-news", "INFOWARS NIGHTLY NEWS", "News", r, d, "from the Alex 24 playlist")
    r, d = playlist_rows(os.path.join(mixed, "Info Survior.m3u"), meta)
    add("cable-tv", "ajn-infowars-survival", "INFO WARS SURVIVAL", "News", r, d, "from the Info Survior playlist")

    for acct, cid, name in (("lars_germany_mittank", "mx-lars-germany-mittank", "Lars Germany Mittank Movies"),
                            ("jt_s_ghost", "mx-jt-s-ghost", "JT's Ghost Movies"), ("aiviixx", "mx-aiviixx", "AIVIIXX Movies")):
        items = json.load(open(os.path.join(a.accounts, f"{acct}.items.json")))
        r, d = item_rows([(i["identifier"], i.get("title") or i["identifier"]) for i in items], meta)
        add("movies-classics-vault", cid, name, "Movies", r, d, f"all {len(items)} movie uploads of @{acct}")

    def random_namer(f, pick, _t):
        orig = (f.get("original") or "").rsplit(".", 1)[0] if f.get("original") else ""
        base = f["name"].rsplit(".", 1)[0]
        return tidy(orig) if orig and not orig.isdigit() else f"Movie {base}"
    # item 36857: untitled numbered movies; only the h.264 derivatives, minimum 20 min so clips/trailers are not movies
    it = meta.get("36857")
    ders = []
    if it and it["state"] == "ok":
        for f in it["files"].values():
            if f["name"].lower().endswith(".mp4") and f["src"] == "derivative": ders.append(f)
    rows, seen, dropped = [], set(), {}
    for f in sorted(ders, key=lambda x: org.natural(x["name"])):
        st, pick, kind, _ = org.resolve("36857", f["name"], meta)
        if st != "ok" or pick["len"] < 1200: dropped["too_short_or_unplayable"] = dropped.get("too_short_or_unplayable", 0) + 1; continue
        k = (round(pick["len"]), pick["size"] // 1_000_000)
        if k in seen: dropped["duplicate"] = dropped.get("duplicate", 0) + 1; continue
        seen.add(k); rows.append(row("36857", pick, it, random_namer(f, pick, "")))
    random.Random(36857).shuffle(rows)
    add("movies-classics-vault", "mx-random-movies", "Random Movies", "Movies", rows, dropped, "Archive item 36857 (untitled numbered files; fixed shuffle)")

    sw = "a7c4f92b3d8e1a6c5b9e0f2a4d6c8b1e3f5a7c9b0d2e4f6a8b0c2d4e6f8a0b2c"
    r, d = item_rows([(sw, "Star Wars")], meta, namer=lambda f, p, t: "Star Wars")
    add("movies-classics-vault", "mx-star-wars", "STAR WARS", "Movies", r, d, "Archive item a7c4f92b...; content confirmed from item thumbnails (Han Solo / C-3PO + R2-D2)")

    for c in chans:
        assert all(x["durationSeconds"] >= 30 for x in c["rows"]) and len({x["id"] for x in c["rows"]}) == len(c["rows"])
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump({"schema": "ajn.extraChannelsManifest.v1", "channels": chans}, open(a.out, "w"), separators=(",", ":"))
    os.makedirs(os.path.dirname(a.report), exist_ok=True); json.dump(report, open(a.report, "w"), indent=1)
    print(json.dumps({k: {x: v[x] for x in ("rows", "hours", "dropped")} for k, v in report.items()}, indent=1))

if __name__ == "__main__": main()
