#!/usr/bin/env python3
"""Add the NEW members of the @infobattalion Archive lists (and two Movies result pages) to their contracts.
Lists (https://archive.org/services/users/@infobattalion/lists): 1 Documentary, 2 Music, 4 Tv Classics, 5 Movies Classics,
6 New World Tyranny, 10 old time radio. Movies pages: @atlas_taggart826 (subject full movie + english sub) and
opensource_movies (query filmography, subjects full movie + english sub, mediatype movies).
Contracts written (all additive; an item already referenced anywhere in app data/code is skipped and reported):
  src/data/extraChannelsManifest.json   classic-tv (tvx-*), movies-classics-vault (mx-*), cable-tv (NWT)
  src/data/documentariesManifest.json   science-documentaries groups
  src/data/archiveAudioChannels.json    audio-podcasts (Old-Time Radio, Music, New World Tyranny audio); mp3 only
Admission = build-organizer-manifest.py resolve(): real runtime from item metadata, no dark/private/missing files, .ia.mp4 preferred,
no <30 s / <100 KB placeholders. Deterministic: same cache -> same output. Run it on a clean copy of the three data files
(`git checkout -- src/data/extraChannelsManifest.json src/data/documentariesManifest.json src/data/archiveAudioChannels.json`), otherwise items it added last time count as "already in app". Usage:
  python tools/build-infobattalion-lists.py --cache DIR [--fetch]    (DIR/lists.json, DIR/*.items.json are fetched when --fetch)
"""
import argparse, glob, importlib.util, json, os, re, urllib.parse, urllib.request, concurrent.futures as cf
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
def load(name):
    s = importlib.util.spec_from_file_location(name, os.path.join(here, name + ".py")); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
org = load("build-organizer-manifest") if False else None
def _load(fn):
    s = importlib.util.spec_from_file_location(fn.replace("-", "_"), os.path.join(here, fn + ".py")); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
org = _load("build-organizer-manifest"); xc = _load("build-extra-channels-manifest")
UA = {"User-Agent": "ajn-infobattalion-lists/1"}
def jget(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120))
def page(**p):
    return jget("https://archive.org/services/search/beta/page_production/?" + urllib.parse.urlencode(p))["response"]["body"]

SKIP_TV = re.compile(r"wwf|wrestl|full-fight|honbasho|survivor|bonus-content|bitchute_|fxm-retro|judge-judy|dvd-transfer|freedownloadvideo|-woc$|^bobbygallery$|^bobbyellery$", re.I)
SKIP_DOC = re.compile(r"$^")
CYR = re.compile("[\u0400-\u04ff]")
SEX = re.compile(r"\bsex\b", re.I)
def cut(s, n=60):
    return s if len(s) <= n else (s[:n].rsplit(" ", 1)[0] if " " in s[:n] else s[:n])
TVISH = re.compile(r"\bs\d{1,2}\s?e\d{1,3}\b|\bseason \d+|\bepisode \d+|\b\d{1,2}x\d{2}\b|60 minutes|abc news|nightline|\bpart \d+ of \d+", re.I)
def tidy_title(t):
    t = re.sub(r"^\d{8} - [A-Za-z0-9_-]{8,} - ", "", t or ""); t = re.sub(r"\.ia$", "", t.strip(), flags=re.I)
    t = re.sub(r"\s*\{imdb-tt\d+\}", "", t); return re.sub(r"\s+", " ", t).strip(" -.")
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]
JUNKT = re.compile(r"\b(x264|x265|hevc|10bit|aac\d?|bluray|brrip|web-?dl|webrip|dvdrip|1080p|720p|480p|complete (tv )?series|full series|\(complete tv series\)|re-?upload)\b|\[[^\]]*\]|【[^】]*】|[★☆]", re.I)
def clean(t):
    raw = xc.tidy(CYR.sub("", (t or "").replace("【", "[").replace("】", "]")))
    t = re.sub(r"\[(?:AULVAC|MPEG[^\]]*|[^\]]*(?:xvid|x264|x265|hevc|bluray|aac)[^\]]*)\]", " ", raw, flags=re.I)
    t = JUNKT.sub(" ", t.replace("[", "").replace("]", ""))
    t = re.sub(r"\(\s*(?:the)?\s*\)", " ", t, flags=re.I)
    t = re.sub(r"\)(?=\w)", ") ", re.sub(r"\b(?:AVI|MPEG-?4?|XviD)\b", " ", t, flags=re.I))
    t = re.sub(r"\s+", " ", t).strip(" -:.,")
    t = re.sub(r"[:\-]?\s*\bthe$", "", t, flags=re.I).strip(" -:.,")
    t = re.sub(r"\s-\sthe\s(?=\d{4}$)", " ", t, flags=re.I)
    if t.count("(") > t.count(")"): t += ")"
    return t or raw
def norm(s): return re.sub(r"[^a-z0-9]", "", re.sub(r"\(\d{4}\)|\bthe\b|complete.*", "", s.lower()))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache", required=True); ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--extra", default="src/data/extraChannelsManifest.json"); ap.add_argument("--docs", default="src/data/documentariesManifest.json")
    ap.add_argument("--audio", default="src/data/archiveAudioChannels.json"); ap.add_argument("--report", default="reports/infobattalion-lists.json")
    ap.add_argument("--existing-classic", default=None, help="saved /api/schedule?guide=classic-tv JSON, used to skip shows that already have a channel")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.cache, "meta"), exist_ok=True)
    lf = os.path.join(a.cache, "lists.json")
    if a.fetch or not os.path.exists(lf): json.dump(jget("https://archive.org/services/users/@infobattalion/lists"), open(lf, "w"))
    L = {l["id"]: l for l in json.load(open(lf))["value"]}
    def items_file(name, fn):
        f = os.path.join(a.cache, name + ".items.json")
        if a.fetch or not os.path.exists(f): json.dump(fn(), open(f, "w"))
        return json.load(open(f))
    def paged(**base):
        out, pg = [], 1
        while True:
            b = page(hits_per_page=100, page=pg, **base); h = b["hits"] if "hits" in b else b["page_elements"]["favorites"]["hits"]
            out += h["hits"]
            if len(out) >= h["total"] or not h["hits"]: return out
            pg += 1
    os_items = items_file("opensource_filmography", lambda: [{"identifier": x["fields"]["identifier"], "title": x["fields"].get("title")} for x in paged(
        user_query="filmography", page_type="collection_details", page_target="opensource_movies",
        filter_map=json.dumps({"subject": {"full movie": "inc", "english sub": "inc"}, "mediatype": {"movies": "inc"}}))])
    atlas_items = items_file("atlas_taggart826", lambda: [{"identifier": x["fields"]["identifier"], "title": x["fields"].get("title")} for x in paged(
        user_query="", page_type="account_details", page_target="@atlas_taggart826", filter_map=json.dumps({"subject": {"full movie": "inc", "english sub": "inc"}}))])
    lists = {n: [m["identifier"] for m in L[i]["members"]] for n, i in (("documentary", 1), ("music", 2), ("tv", 4), ("movies", 5), ("nwt", 6), ("otr", 10))}
    lists["opensource"] = [x["identifier"] for x in os_items]; lists["atlas"] = [x["identifier"] for x in atlas_items]
    if a.fetch:
        ids = list(dict.fromkeys(i for v in lists.values() for i in v))
        def one(i):
            f = os.path.join(a.cache, "meta", org.md5id(i) + ".json")
            if not os.path.exists(f): org.http_get("https://archive.org/metadata/" + urllib.parse.quote(i, safe=""), f)
        with cf.ThreadPoolExecutor(8) as ex: list(ex.map(one, ids))
    meta = org.Meta(a.cache, False)
    titles = {}
    def title_of(i):
        if i not in titles:
            f = os.path.join(a.cache, "meta", org.md5id(i) + ".json")
            titles[i] = (json.load(open(f)).get("metadata", {}).get("title") or i) if os.path.exists(f) else i
            if isinstance(titles[i], list): titles[i] = titles[i][0]
        return titles[i]
    # everything already referenced by the app (read BEFORE this run's own output is written)
    txt = ""
    for pat in ("src/data/*.json", "*.ts", "collections/*.ts", "server/**/*.ts", "src/**/*.ts*"):
        for f in glob.glob(os.path.join(root, pat), recursive=True):
            # libraryIndex/archiveCatalog are the Library SEARCH index, not guides: an item found only there is NOT on any channel.
            if os.path.basename(f) in ("libraryIndex.json", "archiveCatalog.json"): continue
            txt += open(f, errors="ignore").read().lower()
    inapp = lambda i: i.lower() in txt
    existing = set()
    if a.existing_classic and os.path.exists(a.existing_classic):
        existing = {norm(c["name"]) for c in json.load(open(a.existing_classic))["channels"]}
    report = {"skipped_in_app": {}, "dark": {}, "excluded": {}, "channels": {}, "needs_decision": {}}
    claimed = set()
    def pick_new(name):
        out = []
        for i in lists[name]:
            if i.lower() in claimed: report["skipped_in_app"].setdefault(name + "_claimed_by_earlier_list", []).append(i); continue
            it = meta.get(i)
            if not it or it["state"] != "ok": report["dark"].setdefault(name, []).append(i); continue
            if inapp(i): report["skipped_in_app"].setdefault(name, []).append(i); continue
            out.append(i)
        return out
    extra = json.load(open(os.path.join(root, a.extra)))
    chans = [c for c in extra["channels"] if not (c["id"].startswith("tvx-") or c["id"] in ("mx-movies-classics-list", "mx-filmography", "mx-atlas-taggart", "ajn-new-world-tyranny"))]
    def add(guide, cid, name, group, rows, note=""):
        if not rows: return
        chans.append({"guideId": guide, "id": cid, "name": name, "group": group, "rows": rows})
        claimed.update(r["identifier"].lower() for r in rows)
        report["channels"][cid] = {"guide": guide, "name": name, "rows": len(rows), "hours": round(sum(r["durationSeconds"] for r in rows) / 3600), "note": note}
    def rows_for(idents, min_len=0, movies=False):
        rows, dropped = xc.item_rows([(i, title_of(i)) for i in idents], meta, min_len=min_len)
        for r in rows: r["title"] = tidy_title(r["title"])
        keep = [r for r in rows if not SEX.search(r["title"]) and not (movies and TVISH.search(r["title"]))]
        if movies and len(keep) != len([r for r in rows if not SEX.search(r["title"])]): report["excluded"]["tv_episodes_in_movie_lists"] = report["excluded"].get("tv_episodes_in_movie_lists", 0) + len([r for r in rows if not SEX.search(r["title"])]) - len(keep)
        if len(keep) != len(rows): report["excluded"]["sex_whole_word_rows"] = report["excluded"].get("sex_whole_word_rows", 0) + len(rows) - len(keep)
        return keep, dropped
    # ---- Movies
    r, d = rows_for(pick_new("movies"), 2700, True); add("movies-classics-vault", "mx-movies-classics-list", "Movies Classics (list)", "Movies", r, "list 5, new items only; films >= 45 min; TV-episode titles excluded")
    r, d = rows_for(pick_new("opensource"), 2700, True); add("movies-classics-vault", "mx-filmography", "Filmography Collection", "Movies", r, "opensource_movies query filmography; full movie + english sub")
    r, d = rows_for(pick_new("atlas"), 1500, True); add("movies-classics-vault", "mx-atlas-taggart", "Atlas Taggart Picks", "Movies", r, "@atlas_taggart826; full movie + english sub")
    # ---- New World Tyranny (video -> Cable TV; mp3 -> audio channels below)
    r, d = rows_for(pick_new("nwt"), 60); add("cable-tv", "ajn-new-world-tyranny", "NEW WORLD TYRANNY", "News", r, "list 6, video items")
    # ---- Classic TV
    tv_own, tv_single = [], []
    for i in pick_new("tv"):
        if SKIP_TV.search(i): report["excluded"].setdefault("tv", []).append(i); continue
        rs, _ = rows_for([i], 600)
        if not rs: report["excluded"].setdefault("tv_no_playable_runtime", []).append(i); continue
        nm = clean(title_of(i)) or i
        if norm(nm) and norm(nm) in existing: report["skipped_in_app"].setdefault("tv_same_name_channel", []).append(i); continue
        (tv_own if len(rs) >= 3 else tv_single).append((i, nm, rs))
    used = set()
    for i, nm, rs in tv_own:
        cid = "tvx-" + slug(i if slug(nm) in used else nm); used.add(slug(nm))
        add("classic-tv", cid, cut(nm), "Classic TV", rs, f"item {i}")
    if tv_single: add("classic-tv", "tvx-specials-and-singles", "Classic TV Specials & Singles", "Classic TV", [x for _, _, rs in tv_single for x in rs], f"{len(tv_single)} one/two-file items")
    # ---- Documentary
    docs_new = []
    for i in pick_new("documentary"):
        rs, _ = rows_for([i], 300)
        if not rs: report["excluded"].setdefault("documentary_no_playable_runtime", []).append(i); continue
        t0 = title_of(i)
        if len(CYR.findall(t0)) > len(t0) * 0.3: report["excluded"].setdefault("russian_language_title", []).append(i); continue
        docs_new.append((i, clean(t0) or i, rs))
    docs = json.load(open(os.path.join(root, a.docs)))
    docs = [e for e in docs if not e.get("_ib")]
    def dentry(g, r):
        m = re.search(r"s(\d{1,2})\s*[ ._-]?e(\d{1,3})", r["title"], re.I) or re.search(r"\b(\d{1,2})x(\d{2,3})\b", r["title"])
        return {"g": g, "id": r["identifier"], "t": r["title"], "s": int(m.group(1)) if m else None, "e": int(m.group(2)) if m else None, "d": r["durationSeconds"],
                "u": "https://archive.org/download/" + r["identifier"] + "/" + urllib.parse.quote(r["file"], safe="/()'!,&$@=;:+"), "_ib": 1}
    singles = []
    for i, nm, rs in docs_new:
        claimed.update(r["identifier"].lower() for r in rs)
        if len(rs) >= 3: docs += [dentry(cut(nm), r) for r in rs]
        else: singles += rs
    docs += [dentry("More Documentaries", r) for r in singles]
    report["channels"]["documentaries"] = {"new_groups": len({e['g'] for e in docs if e.get('_ib')}), "new_rows": sum(1 for e in docs if e.get("_ib"))}
    # ---- Audio (mp3 only: server/rush.ts resolveRushItem)
    audio = [x for x in json.load(open(os.path.join(root, a.audio))) if not x.get("_ib")]
    taken = {x["id"] for x in audio}
    def mp3_ok(i):
        it = meta.get(i)
        return it and it["state"] == "ok" and sum(1 for f in it["files"].values() if f["name"].lower().endswith(".mp3") and not f["priv"] and f["len"] > 0) >= 1
    for name, group, prefix in (("otr", "Old-Time Radio", "otr"), ("nwt", "New World Tyranny", "nwt-audio"), ("music", "Music", "music")):
        for i in pick_new(name):
            if not mp3_ok(i): report["needs_decision"].setdefault(name + "_non_mp3_or_video", []).append(i); continue
            cid = prefix + "-" + slug(i)
            if cid in taken: continue
            taken.add(cid)
            e = {"id": cid, "name": (lambda n: n if len(re.sub(r"\W", "", n)) >= 2 else i)(cut(clean(title_of(i)))), "group": group, "itemId": i, "source": "https://archive.org/details/" + i, "verifiedAt": "2026-10-10", "_ib": 1}
            if name == "music": e["maxSlots"] = 48
            audio.append(e)
    report["channels"]["audio"] = {"new": sum(1 for x in audio if x.get("_ib"))}
    json.dump({"schema": "ajn.extraChannelsManifest.v1", "channels": chans}, open(os.path.join(root, a.extra), "w"), separators=(",", ":"))
    for e in docs: e.pop("_ib", None)
    for e in audio: e.pop("_ib", None)
    json.dump(docs, open(os.path.join(root, a.docs), "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump(audio, open(os.path.join(root, a.audio), "w"), indent=1, ensure_ascii=False)
    os.makedirs(os.path.dirname(os.path.join(root, a.report)), exist_ok=True)
    json.dump(report, open(os.path.join(root, a.report), "w"), indent=1)
    print(json.dumps({"channels": report["channels"], "skipped": {k: len(v) for k, v in report["skipped_in_app"].items()}, "dark": {k: len(v) for k, v in report["dark"].items()},
                      "excluded": {k: (len(v) if isinstance(v, list) else v) for k, v in report["excluded"].items()}, "needs_decision": {k: len(v) for k, v in report["needs_decision"].items()}}, indent=1))
if __name__ == "__main__": main()
