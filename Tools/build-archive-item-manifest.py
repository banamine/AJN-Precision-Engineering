#!/usr/bin/env python3
"""Build src/data/archiveItemManifest.json (+ .excluded.json) for ONE Archive item.

Usage:
  python tools/build-archive-item-manifest.py                      # fetches https://archive.org/metadata/<item>
  python tools/build-archive-item-manifest.py --metadata m.json    # offline, from a saved metadata response
Standard library only. Deterministic: same metadata -> byte-identical output (no wall-clock values).
Rules are documented in claude/AJN_2015_Music_Item_Sorting_Plan_2026-10-06.md.
"""
import argparse, collections, hashlib, json, re, sys, urllib.request
from pathlib import Path

ITEM = "2015-music.-7z"
RULES_VERSION = 3
PLAY_EXT = {"mp3", "mp4", "opus", "webm", "m4a"}
AUDIO_EXT = {"mp3", "opus", "m4a"}
CYR = re.compile("[Ѐ-ӿ]")
RU = re.compile(r"b37mrtl|\.ru[%/:]|\.russian\.|best russian", re.I)
HEVC = re.compile(r"x265|hevc|h\.?265", re.I)
WRAP = re.compile(r"^(VOM|#\d+( \(\d+\))?)$")
SXE = re.compile(r"[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})")
NXN = re.compile(r"(?<![\d])(\d{1,2})x(\d{2,3})(?![\d])")
JUNK = re.compile(r"\[[^\]]*\]|\b(x264|x265|HEVC|h264|XViD|WEB-?DL|WEBRip|BluRay|BRRip|HDRip|DVDRip|TVRip|AMZN|10bit|EAC3|AAC\d?(\.\d)?|MvGroup\S*|ETRG|YIFY|1080p|720p|540p|480p|360p|i_c|ImE)\b", re.I)

# folder-name regex -> (series display name, existing channel id reused from this SAME item or None,
#                      conflict channel id from ANOTHER source or None)
TV_SERIES = [
    (r"odd couple[^/]*2015|\(2015\)[^/]*odd couple", "The Odd Couple (2015)", None, None),
    (r"odd couple",            "The Odd Couple",          "classic-70-odd-couple", None),
    (r"rat patrol",            "The Rat Patrol",          "classic-rat-patrol",    None),
    (r"petticoat",             "Petticoat Junction",      None, "classic-petticoat"),
    (r"hogan",                 "Hogan's Heroes",          None, "classic-hogans"),
    (r"fugitive",              "The Fugitive",            None, "classic-the-fugitive"),
    (r"u\.?n\.?c\.?l\.?e",     "The Man from U.N.C.L.E.", None, "classic-the-man-from-u-n-c-l-e"),
    (r"sopranos",              "The Sopranos",            None, "classic-the-sopranos"),
    (r"river monsters",        "River Monsters",          None, "classic-river-monsters"),
    (r"total drama",           "Total Drama",             None, "classic-total-drama"),
    (r"honeymooner",           "The Honeymooners",        None, "classic-honeymooner-classic-movies"),
    (r"andy griffith",         "The Andy Griffith Show",  None, None),
    (r"addams family",         "The Addams Family",       None, None),
    (r"home improvement",      "Home Improvement",        None, None),
    (r"cheers",                "Cheers",                  None, None),
    (r"black sheep squadron",  "Black Sheep Squadron",    None, None),
    (r"corner gas",            "Corner Gas",              None, None),
    (r"schitt",                "Schitt's Creek",          None, None),
    (r"the protectors",        "The Protectors",          None, None),
    (r"grizzly adams",         "The Life and Times of Grizzly Adams", None, None),
    (r"north and south",       "North and South",         None, None),
    (r"high incident",         "High Incident",           None, None),
    (r"fighting marines",      "The Fighting Marines",    None, None),
    (r"angry beavers",         "The Angry Beavers",       None, None),
    (r"undermind",             "Undermind",               None, None),
    (r"pirates of the high seas", "Pirates of the High Seas", None, None),
    (r"canadas worst",         "Canada's Worst Driver",   None, None),
]
DOC_SERIES = [  # folder/file regex -> documentary channel name
    (r"how it'?s made",            "How It's Made"),
    (r"cold war",                  "Cold War (24-part series)"),
    (r"rome[ -]+rise",             "Rome: Rise and Fall of an Empire"),
    (r"best documentar",           "Best Documentaries"),
    (r"smith?sonian",              "Smithsonian"),
    (r"mantracker",                "Mantracker"),
    (r"trafficked",                "Trafficked with Mariana van Zeller"),
    (r"michael palin",             "Full Circle with Michael Palin"),
    (r"history channel",           "History Channel"),
    (r"catastrophe",               "Catastrophe: Natural Disasters"),
]
DOC_MISC = re.compile(r"discovery|channel[ .]?[45][ .]|documentar|flight 93|\bFUBAR\b", re.I)
DOC = re.compile("|".join(r for r, _ in DOC_SERIES) + "|" + DOC_MISC.pattern, re.I)
EXTRA_SEG = re.compile(r"^(extras?|xtras|bonus\b.*|miscellaneous\b.*|sound ?bites\b.*|.* xtras\b.*)$", re.I)
GENERIC_FOLDER = re.compile(r"^(dual \d+|season[ _]?\d+|s\d+|extras|mp4|cwd|#.*|sample|vom)$", re.I)
MOVIE = re.compile(r"\((19|20)\d\d\)|[a-z](19|20)\d\d\.(ia\.)?mp4$|\b(19|20)\d\d\b.*\b(BluRay|BRRip|HDRip|DVDRip|YIFY)\b|\b(BluRay|BRRip|HDRip|YIFY)\b|other movies", re.I)
MUSIC_DIR = re.compile(r"music folder|billboard|discography|radio hits|greatest love|hot 100|dance album|school days|hi-res masters|\bPMEDIA\b|bubanee|m1 folder|ac dc|\bVA\b - |various artists", re.I)
TRACK = re.compile(r"^\s*\d{1,3}\s*[-. ]\s*\S")
OTHER_DIR = re.compile(r"^(podcasts|books|wild sport|paul harvey|tucker carlson|trumpsings|killing the mob)\b|^[A-Z]-[A-Z]$|^MP#3$", re.I)


MUSIC_NOISE = re.compile(r"\s*(\[[^\]]*\]|\(?\bMp3 320kbps( Quality Album)?\)?|\(?\bFLAC\b\)?|\bOPUS\b|\bPack\b|\bvtwin88cube\b|\b24Bit\b|\u2b50\ufe0f?|\ufe0f)", re.I)
def music_collection(path):
    """Channel name for a music row: the album / chart / pack folder, cleaned. Loose root files -> one channel."""
    s = [x for x in path.split("/")]
    if len(s) == 1: return "Loose Tracks"
    if s[0] == "VOM": folder = s[1] if len(s) > 2 else "Loose Tracks"
    elif s[0].startswith("#01"): folder = s[3] if len(s) > 4 else "Loose Tracks"
    else: folder = "Loose Tracks"
    if re.match(r"m1 folder|m3#", folder, re.I): folder = "Mixed Playlists"
    n = MUSIC_NOISE.sub(" ", folder)
    n = re.sub(r"[_]+", ":", n); n = re.sub(r"\s+", " ", n).strip(" -")
    n = re.sub(r"\(\s*$", "", n).strip(" -")
    n = re.sub(r"\(([^()]*)$", r"(\1)", n)
    n = re.sub(r"^(VA|Various Artists) - ", "", n)
    n = re.sub(r"^Eagles - Discography.*", "Eagles - Discography 1972-2018", n)
    n = re.sub(r"^AC DC - Rock Box.*", "AC/DC - Rock Box", n)
    return n or "Loose Tracks"

def parse_len(v):
    """Archive 'length' is seconds ('193.8') or mm:ss / h:mm:ss ('04:02'). Returns float seconds or None."""
    if v in (None, ""): return None
    try:
        if ":" in str(v):
            parts = [float(x) for x in str(v).split(":")]
            sec = 0.0
            for x in parts: sec = sec * 60 + x
            return round(sec, 2)
        return round(float(v), 2)
    except ValueError:
        return None

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "x"
def ext_of(n): return n.rsplit(".", 1)[-1].lower() if "." in n.rsplit("/", 1)[-1] else ""
def stem_key(n): return re.sub(r"\.(ia\.)?(mp4|mp3|opus|webm|m4a)$", "", n, flags=re.I)
def core_segments(path):
    segs = path.split("/")
    i = 0
    while i < len(segs) - 1 and WRAP.match(segs[i]): i += 1
    return segs[i:]
def clean_title(fname):
    s = stem_key(fname)
    s = re.sub(r"\.(ia)$", "", s)
    s = s.replace("_", " ")
    if " " not in s and s.count(".") >= 3: s = s.replace(".", " ")
    s = JUNK.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" -._")
    return s or fname
def natkey(s): return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]

def load(args):
    if args.metadata: return json.load(open(args.metadata, encoding="utf-8"))
    req = urllib.request.Request(f"https://archive.org/metadata/{ITEM}", headers={"User-Agent": "AJN-manifest-builder/1"})
    return json.load(urllib.request.urlopen(req, timeout=120))

def classify(path, kind, core):
    """returns (lane, series_or_None, season, episode, existing_channel, conflict, reason)"""
    fname = core[-1]
    folders = core[:-1]
    joined = "/".join(core)
    top = core[0]
    if OTHER_DIR.search(top) and not DOC.search(joined):
        return ("other", None, None, None, None, None, f"top folder '{top}' is spoken/clip content")
    for rx, name, existing, conflict in TV_SERIES:
        if re.search(rx, joined, re.I):
            if any(EXTRA_SEG.match(seg.strip()) for seg in folders):
                return ("other", name, None, None, None, None, f"extra of '{name}', not an episode")
            m = SXE.search(fname) or SXE.search(joined) or NXN.search(fname)
            return ("tv", name, int(m.group(1)) if m else None, int(m.group(2)) if m else None, existing, conflict, None)
    dm = SXE.search(fname) or SXE.search(joined) or NXN.search(fname)
    if DOC.search(joined):
        return ("documentary", None, int(dm.group(1)) if dm else None, int(dm.group(2)) if dm else None, None, None, None)
    m = SXE.search(fname) or NXN.search(fname)
    if m and kind == "video":
        before = fname[:m.start()]
        if " " not in before.strip(): before = before.replace(".", " ")
        before = clean_title(before).strip(" -._")
        if not before and folders and not GENERIC_FOLDER.match(folders[-1]): before = clean_title(folders[-1])
        if before: return ("tv", before, int(m.group(1)), int(m.group(2)), None, None, None)
    if kind == "audio":
        if MUSIC_DIR.search(joined) or TRACK.match(fname):
            return ("music", None, None, None, None, None, None)
        return ("unsorted", None, None, None, None, None, "audio file with no music folder or track-number pattern")
    if MOVIE.search(joined): return ("movies", None, None, None, None, None, None)
    return ("unsorted", None, None, None, None, None, "video file with no series, documentary, or movie pattern")

OPUS_DUR = {}
_od = Path(__file__).with_name("opus-durations.json")
if _od.exists(): OPUS_DUR = json.loads(_od.read_text(encoding="utf-8"))  # measured from Ogg last-page granule via Range requests

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--metadata"); ap.add_argument("--out", default="src/data")
    args = ap.parse_args()
    meta = load(args.metadata and args)
    files = meta["files"]; byname = {f["name"]: f for f in files}
    excluded = []
    def exclude(path, reason, **kw): excluded.append({"path": path, "reason": reason, **kw})

    # thumbnails: lowest frame number per media stem
    thumbs = {}
    pre = f"{ITEM}.thumbs/"
    for n in byname:
        if n.startswith(pre) and n.lower().endswith(".jpg"):
            m = re.match(r"(.*)_(\d+)\.jpg$", n[len(pre):], re.I)
            if m:
                k = m.group(1)
                if k not in thumbs or int(m.group(2)) < thumbs[k][0]: thumbs[k] = (int(m.group(2)), n)

    # group playable candidates by logical stem
    groups = collections.defaultdict(list)
    nonplay_av = collections.defaultdict(list)
    for f in files:
        n, src = f["name"], f.get("source")
        if n.startswith(pre): continue
        e = ext_of(n)
        if src not in ("original", "derivative"):
            continue
        if e in PLAY_EXT:
            if CYR.search(n) or RU.search(n):
                exclude(n, "russian: Cyrillic name or Russian-hosted/Russian-language marker"); continue
            groups[stem_key(n)].append(f)
        elif e in {"avi", "mkv", "flac", "wav", "mpg", "wmv", "mov", "ogg", "m4v", "flv"}:
            nonplay_av[n.rsplit(".", 1)[0]].append(f)
        else:
            pass  # images, txt, m3u, srt, xml, torrent...: not audio/video, counted only in summary
    non_av = collections.Counter(ext_of(f["name"]) for f in files if not f["name"].startswith(pre)
                                 and ext_of(f["name"]) not in PLAY_EXT | {"avi","mkv","flac","wav","mpg","wmv","mov","ogg","m4v","flv"})
    for k, v in nonplay_av.items():
        if k not in groups and not any(CYR.search(x["name"]) or RU.search(x["name"]) for x in v):
            for x in v:
                if x.get("source") == "original":
                    exclude(x["name"], f"no browser-playable derivative for .{ext_of(x['name'])}")

    def rank(f):
        n = f["name"].lower()
        if n.endswith(".ia.mp4"): return 0
        if n.endswith(".mp4") and f.get("source") == "derivative": return 1
        if n.endswith(".mp4"): return 2
        if n.endswith(".opus") or n.endswith(".webm"): return 3
        return 4  # mp3 / m4a
    chosen = []
    for k, v in groups.items():
        v = sorted(v, key=lambda f: (rank(f), len(f["name"])))
        best = v[0]
        if rank(best) == 2 and HEVC.search(best["name"]):
            exclude(best["name"], "HEVC/x265 original with no h.264 derivative (not browser-safe)"); continue
        chosen.append(best)
        for other in v[1:]:
            exclude(other["name"], "same title also available as a preferred format", keptAs=best["name"])

    # md5 de-dup across logical items
    items, seen = [], {}
    def pref(f):
        p = f["name"]; return (len(p), p.lower())
    for f in sorted(chosen, key=pref):
        md5 = f.get("md5")
        if md5 and md5 in seen:
            exclude(f["name"], "duplicate content (same md5)", keptAs=seen[md5]); continue
        if md5: seen[md5] = f["name"]
        items.append(f)

    out_items = []
    for f in items:
        path = f["name"]; e = ext_of(path)
        kind = "audio" if e in AUDIO_EXT else "video"
        core = core_segments(path)
        lane, series, season, episode, existing, conflict, reason = classify(path, kind, core)
        title = clean_title(core[-1])
        if lane == "tv" and series:
            cid = existing or ("item-" + slug(series))
            chname = series
        elif lane == "unsorted":
            cid, chname = "item-unsorted", "Unsorted"
        elif lane == "documentary":
            chname = next((nm for rx, nm in DOC_SERIES if re.search(rx, "/".join(core), re.I)), "Documentaries (misc)")
            cid = "item-doc-" + slug(chname)
        elif lane == "music":
            chname = "Music: " + music_collection(path)
            cid = "item-music-" + slug(chname[len("Music: "):])
        else:
            cid, chname = f"item-{lane}", {"movies": "Movies", "other": "Other"}[lane]
        guide = lane in ("tv", "documentary", "unsorted", "music") and conflict is None
        why = reason
        if conflict: why = f"series already has channel '{conflict}' from another Archive source; kept there (one source per channel)"
        elif lane not in ("tv", "documentary", "unsorted", "music"): why = reason or "lane deferred (not in first guide scope)"
        tk = stem_key(path); tk2 = re.sub(r"\.ia$", "", tk)
        th = (thumbs.get(tk) or thumbs.get(tk2) or (None, None))[1]
        out_items.append({
            "id": "ia-" + hashlib.sha1(path.encode("utf-8")).hexdigest()[:12],
            "channelId": cid, "channelName": chname, "lane": lane, "kind": kind,
            "title": title, "series": series, "season": season, "episode": episode,
            "path": path, "bytes": int(f.get("size", 0)), "md5": f.get("md5"),
            "durationSeconds": (parse_len(f.get("length")) or OPUS_DUR.get(path)) if kind == "audio" else None,
            "thumb": th, "guide": guide, "reason": why, "conflictWith": conflict,
        })
    out_items.sort(key=lambda x: (x["lane"], x["channelId"], x["season"] if x["season"] is not None else 10**6,
                                  x["episode"] if x["episode"] is not None else 10**6, natkey(x["path"])))
    chans = collections.OrderedDict()
    for it in out_items:
        c = chans.setdefault(it["channelId"], {"id": it["channelId"], "name": it["channelName"], "lane": it["lane"],
                                              "count": 0, "guide": it["guide"], "conflictWith": it["conflictWith"]})
        c["count"] += 1
    summary = {
        "items": len(out_items),
        "byLane": dict(collections.Counter(i["lane"] for i in out_items)),
        "inGuide": sum(i["guide"] for i in out_items),
        "withThumb": sum(1 for i in out_items if i["thumb"]),
        "excludedByReason": dict(collections.Counter(re.sub(r":.*", "", e["reason"]) for e in excluded)),
        "nonAudioVideoFilesIgnoredByExt": dict(non_av.most_common(12)),
    }
    manifest = {"schema": "ajn.archiveItemManifest.v1", "rulesVersion": RULES_VERSION, "item": ITEM,
                "itemLastUpdated": meta.get("item_last_updated"), "downloadBase": f"/download/{ITEM}/",
                "summary": summary, "channels": list(chans.values()), "items": out_items}
    outdir = Path(args.out); outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "archiveItemManifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    guide_only = dict(manifest); guide_only["items"] = [i for i in out_items if i["guide"]]
    guide_only["channels"] = [c for c in manifest["channels"] if c["guide"]]
    guide_only["note"] = "Subset of archiveItemManifest.json with guide:true (Classic TV, documentaries, Unsorted, Music). Same schema."
    (outdir / "archiveItemManifest.guide.json").write_text(json.dumps(guide_only, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    excluded.sort(key=lambda e: (e["reason"], e["path"]))
    (outdir / "archiveItemManifest.excluded.json").write_text(json.dumps({"schema": "ajn.archiveItemManifest.excluded.v1", "item": ITEM, "count": len(excluded), "excluded": excluded}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=1))

if __name__ == "__main__":
    main()
