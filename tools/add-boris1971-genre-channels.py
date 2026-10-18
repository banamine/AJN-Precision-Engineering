#!/usr/bin/env python3
"""Add the @boris1971 Archive uploads (mediatype movies, 395 items on 2026-10-17: https://archive.org/details/@boris1971?and[]=mediatype:"movies")
to src/data/extraChannelsManifest.json, sorted by genre. Additive: re-running replaces only the channels this script owns (ids "mxb-*" / "tvb-*").
  Films / one-off TV movies  -> Movies guide (movies-classics-vault): one channel per genre, group = genre, one row per film.
  Multi-episode series       -> Classic TV guide (classic-tv): one channel per series, group = "<genre> TV", rows in episode order.
Admission (same spirit as build-organizer-manifest.py): h.264 .mp4 derivative only (never .mkv), real runtime/size from item metadata,
no dark/private/access-restricted files, SEX-word rule (server/catalog/rules.ts), runtime >= 10 min (>= 5 min inside a series),
colourised duplicate of an existing B&W film skipped, items already referenced elsewhere in the app skipped (SKIP_IN_APP).
Genre = the item's own subject tags (first match in GENRE_RULES order wins) with a title-keyword fallback.
Usage: python tools/add-boris1971-genre-channels.py --meta all_meta.json --list uploads.json   (meta = {identifier: archive.org/metadata/<id>}, list = page_production uploads hits)"""
import argparse, hashlib, json, os, re, collections
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_IN_APP = {"the-last-chase-1981_202512", "runaway-1984_202512", "bridge-across-time-1985", "doctor-dolittle-complete-series-1970", "the-final-programme-1973_202512", "doc-savage-the-man-of-bronze-1975_202511", "the-prisoner-complete-series-2009", "the-prisoner-complete-series-1967", "fawlty-towers-complete-series-1975", "survivors-1975", "the-master-complete-series-1984", "the-fantastic-journey-1977_202504", "Hg-wells-the-shape-of-things-to-come-1979"}
# (genre label, movie-channel name, tags/keywords). Order matters: the more specific genre wins.
GENRE_RULES = [
  ("Documentary", "Documentaries: Mysteries & Monsters", r"documentar|bigfoot|sasquatch|yeti|in search of|unexplained|true story of"),
  ("Animation", "Animated Movies & Cartoons", r"animated|cartoon|anime|animation"),
  ("Western", "Western Movies", r"\bwestern\b|cowboy|gunslinger"),
  ("Horror", "Horror & Monster Movies", r"horror|monster|vampire|werewolf|zombie|ghost|haunt|kaiju|frankenstein|dracula|mummy|gothic|slasher|demon"),
  ("Sci-Fi", "Sci-Fi & Superhero Movies", r"sci-?fi|science fiction|superhero|super-hero|time travel|dystopian|alien|space|robot|cyberpunk|ufo"),
  ("Fantasy", "Fantasy & Sword-and-Sorcery Movies", r"fantasy|sword and sorcery|magic|dragon|lost worlds|mythology|legend of"),
  ("Martial Arts", "Martial Arts Movies", r"martial arts|kung ?fu|karate|ninja|samurai"),
  ("Mystery & Crime", "Mystery, Crime & Spy Movies", r"mystery|crime|detective|spy|thriller|noir|heist|gangster|police|murder|suspense"),
  ("War", "War & History Movies", r"\bwar\b|world war|military|vietnam"),
  ("Comedy", "Comedy Movies", r"comedy|sitcom|parody|satire"),
  ("Action & Adventure", "Action & Adventure Movies", r"action|adventure|extreme|survival"),
  ("Drama", "Drama Movies", r"drama|romance|melodrama|biograph"),
]
GENRE_ORDER = [g[0] for g in GENRE_RULES]
# Genres with only a handful of films share one movie channel (series keep their own genre label)
MOVIE_MERGE = {"Western": "Action & Adventure", "Martial Arts": "Action & Adventure"}
EP = re.compile(r"(?:^|[^a-z0-9])(s\d{1,2}\s*e\d{1,3}|e\d{1,3}|ep\.? ?\d{1,3}|episode ?\d{1,3}|\d{1,2}x\d{1,3}|part ?\d{1,2})(?!\d)", re.I)
SEX_WORD = re.compile(r"(^|[^A-Za-z0-9])sex($|[^A-Za-z0-9])", re.I)
def plain(v):
    s = " ; ".join(v) if isinstance(v, list) else str(v or "")
    return re.sub(r"&nbsp;|&amp;", " ", re.sub(r"<[^>]*>", " ", re.sub(r"data:[^\s\"')]+", " ", s)))
def tidy(t):
    t = re.sub(r"\s+", " ", plain(t).replace("_", " ")).strip(" -.")
    return re.sub(r"\s(\d{4})$", r" (\1)", t)
def natkey(n): return re.sub(r"(\d+)", lambda x: x.group(1).zfill(6), n.lower())
def genre_of(md):
    tags = md.get("subject") or []
    tags = [tags] if isinstance(tags, str) else tags
    tagtxt = " | ".join(t.lower() for t in tags)
    for g, _, rx in GENRE_RULES:
        if re.search(rx, tagtxt): return g
    title = plain(md.get("title")).lower()
    for g, _, rx in GENRE_RULES:
        if re.search(rx, title): return g
    if re.search(r"sitcom|situation comedy|comedy series", plain(md.get("description")).lower()): return "Comedy"
    return "Drama"
def videos(m, min_len):
    vids = [f for f in m["files"] if f["name"].lower().endswith(".mp4") and ".thumbs/" not in f["name"] and f.get("private") != "true" and f.get("format") == "h.264" and float(f.get("length") or 0) >= min_len]
    nocolor = [f for f in vids if not re.search(r"colou?r", f["name"], re.I)]
    vids = nocolor or vids
    vids.sort(key=lambda f: natkey(f["name"]))
    return vids
def row(ident, f, title):
    return {"id": "xc-" + hashlib.md5(f"{ident}/{f['name']}".encode()).hexdigest()[:14], "identifier": ident, "file": f["name"], "title": title, "bytes": int(f["size"]), "durationSeconds": round(float(f["length"])), "thumb": "__ia_thumb.jpg"}
def is_series(md, vids):
    if len(vids) < 3: return False
    tags = md.get("subject") or []; tags = [tags] if isinstance(tags, str) else tags
    tagtxt = " | ".join(t.lower() for t in tags) + " " + plain(md.get("title")).lower()
    eps = sum(1 for f in vids if EP.search(f["name"].rsplit("/", 1)[-1]))
    return eps >= 0.6 * len(vids) or bool(re.search(r"(^|[^a-z])(tv|series|mini series|cartoon series|animated series)([^a-z]|$)", tagtxt)) and eps >= 2
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--meta", required=True); ap.add_argument("--list", required=True); a = ap.parse_args()
    meta = json.load(open(a.meta)); order = [x["fields"]["identifier"] for x in json.load(open(a.list))]
    p = os.path.join(root, "src/data/extraChannelsManifest.json"); d = json.load(open(p))
    d["channels"] = [c for c in d["channels"] if not (c["id"].startswith("mxb-") or c["id"].startswith("tvb-") or c["id"].startswith("mx-genre-"))]
    skipped = collections.Counter(); movies = collections.defaultdict(list); series = []
    for ident in order:
        if ident in SKIP_IN_APP: skipped["already in app"] += 1; continue
        m = meta.get(ident)
        if not m: skipped["no metadata"] += 1; continue
        md = m["metadata"]
        if m.get("is_dark") or md.get("access-restricted-item") == "true": skipped["dark/restricted"] += 1; continue
        if any(SEX_WORD.search(plain(md.get(k))) for k in ("title", "description", "subject")): skipped["sex-word rule"] += 1; continue
        g = genre_of(md); title = tidy(md.get("title"))
        sv = videos(m, 300)
        if is_series(md, sv):
            rows = [row(ident, f, tidy(f["name"].rsplit("/", 1)[-1].rsplit(".", 1)[0])) for f in sv]
            series.append((g, title, ident, rows)); continue
        mv = videos(m, 600)
        if not mv: skipped["no playable h.264 file >= 10 min"] += 1; continue
        for f in mv:
            movies[g].append(row(ident, f, title if len(mv) == 1 else tidy(f["name"].rsplit("/", 1)[-1].rsplit(".", 1)[0])))
    names = {g[0]: g[1] for g in GENRE_RULES}; names["Action & Adventure"] = "Action, Adventure & Western Movies"
    merged = collections.defaultdict(list)
    for g, rows in movies.items(): merged[MOVIE_MERGE.get(g, g)] += rows
    movies = merged
    new = []
    for g in GENRE_ORDER:
        if movies.get(g):
            rows = sorted(movies[g], key=lambda r: r["title"].lower())
            new.append({"guideId": "movies-classics-vault", "id": "mxb-" + re.sub(r"[^a-z0-9]+", "-", g.lower()).strip("-"), "name": names[g], "group": g, "rows": rows})
    for g, title, ident, rows in sorted(series, key=lambda s: (GENRE_ORDER.index(s[0]), s[1].lower())):
        new.append({"guideId": "classic-tv", "id": "tvb-" + re.sub(r"[^a-z0-9]+", "-", ident.lower()).strip("-"), "name": title, "group": f"{g} TV", "rows": rows})
    d["channels"] += new
    json.dump(d, open(p, "w", encoding="ascii"), separators=(",", ":"), ensure_ascii=True)  # ASCII-only: Google Builder export mangled astral chars (CESU-8) in file names
    for c in new: print(f"{c['guideId']:22} {c['id']:60} {len(c['rows']):4} rows  {sum(r['durationSeconds'] for r in c['rows'])/3600:6.1f} h  [{c['group']}] {c['name'][:50]}")
    print("skipped:", dict(skipped), "| movie channels", sum(1 for c in new if c['guideId'].startswith('movies')), "| series channels", len(series), "| films", sum(len(v) for v in movies.values()))
main()
