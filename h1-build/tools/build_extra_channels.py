#!/usr/bin/env python3
"""
Convert H1 v2 items into extraChannelsManifest channels using Archive /metadata/<identifier>.json files ALREADY on disk.
Makes NO network requests.

  python3 -I build_extra_channels.py --h1 manifest.json --meta-dir DIR --base extraChannelsManifest.json \
        --out new.json --sidecar-out audio-sidecar.json --report report.json

* Every category is converted, including Music, News/Talk, Old-Time Radio and Unsorted.
* VIDEO files  -> --out (same guides/groups as the existing manifest; new groups only for Music/Radio/Unsorted).
* AUDIO files  -> --sidecar-out (same schema, guideId "audio-vault"). The existing manifest has no audio rows, so audio is kept
                  out of the main file until the app is confirmed to accept it.
* Files the system is unsure about (container mismatch, unknown size/duration) are NOT dropped: they are listed under
  report.deferredFiles with status deferred_owner_decision.
* Items whose metadata says is_dark are excluded (report.darkItems) and never become rows.
* Private file entries are never rows (deferred as private_file).
* Items without a metadata file cannot become rows (rows need file, bytes, duration): report.needsMetadata.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_lib import clean_title, file_kind
from extra_channels_lib import make_row, parse_length, validate, slug, MIN_SECONDS

DEFER = "deferred_owner_decision"
VIDEO_TARGET = {                     # H1 category -> (guideId, group) for video files
    "Classic TV": ("classic-tv", "Classic TV"),
    "Movies Classics": ("movies-classics-vault", "Movies"),
    "Documentaries": ("classic-tv", "Documentary TV"),
    "News/Talk archives": ("cable-tv", "News"),
    "Music": ("classic-tv", "Music Videos"),
    "Old-Time/Radio archives": ("classic-tv", "Radio"),
    "Unsorted - review": ("classic-tv", "Unsorted - review"),
}
AUDIO_GUIDE = "audio-vault"
AUDIO_GROUP = {"Music": "Music", "Old-Time/Radio archives": "Radio", "News/Talk archives": "News",
               "Unsorted - review": "Unsorted - review", "Classic TV": "Classic TV",
               "Movies Classics": "Movies", "Documentaries": "Documentary TV"}
import re
DERIV_SUFFIX = re.compile(r"(\.ia|_\d+kb|_vbr)$", re.I)     # Archive derivative naming: name.ia.mp4, name_64kb.mp3 (assumed; verify on real metadata)
PREFER = {"h.264": 0, "mpeg4": 1, "vbr mp3": 0, "mp3": 1}

def _stem(name, strip_ia):
    base = os.path.splitext(name)[0]
    return DERIV_SUFFIX.sub("", base) if strip_ia else re.sub(r"(_\d+kb|_vbr)$", "", base, flags=re.I)

def pick_files(files, allow_mismatch=False):
    """-> (chosen {'video'|'audio': [(name,size,sec)]}, skipped [(name,reason)], deferred [(name,reason)])

    Private file entries (private == "true") are never turned into rows: they are listed as deferred (private_file).
    Archive's ".ia" derivative marker is stripped from a stem only when another public file of the same kind has the
    stripped stem. A standalone source=original "Title.1948.ia.mp4" keeps ".ia" so it is not merged with a different file.
    """
    best, skipped, deferred = {}, [], []
    cands = []
    for f in files:
        name = f.get("name", ""); fmt = f.get("format") or ""
        kind, problem = file_kind(name, fmt)
        if kind == "other": continue
        if str(f.get("private", "")).lower() == "true": deferred.append((name, "private_file")); continue
        if problem and not allow_mismatch: deferred.append((name, problem)); continue
        sec = parse_length(f.get("length"))
        if sec is None: deferred.append((name, "duration_unknown")); continue
        try: size = int(float(f.get("size")))
        except (TypeError, ValueError): size = 0
        if size <= 0: deferred.append((name, "size_unknown")); continue
        if sec < MIN_SECONDS: skipped.append((name, "under_30_seconds")); continue
        cands.append((kind, f, name, fmt, size, sec))
    plain = {(kind, _stem(name, False)) for kind, f, name, fmt, size, sec in cands if not re.search(r"\.ia$", os.path.splitext(name)[0], re.I)}
    for kind, f, name, fmt, size, sec in cands:
        base = os.path.splitext(name)[0]
        norm = _stem(name, True)
        strip_ia = bool(re.search(r"\.ia$", base, re.I)) and (kind, norm) in plain
        stem = norm if strip_ia or not re.search(r"\.ia$", base, re.I) else _stem(name, False)
        rank = (PREFER.get(fmt.lower(), 5), 0 if f.get("source") == "original" else 1)
        key = (kind, stem)
        if key not in best or rank < best[key][0]: best[key] = (rank, name, size, sec)
    out = {"video": [], "audio": []}
    for (kind, _), v in sorted(best.items(), key=lambda kv: kv[1][1]): out[kind].append(v[1:])
    return out, skipped, deferred

def main():
    ap = argparse.ArgumentParser()
    for k in ("--h1", "--meta-dir", "--base", "--out", "--sidecar-out", "--report"): ap.add_argument(k, required=True)
    ap.add_argument("--allow-mismatch", action="store_true")
    a = ap.parse_args()
    h1 = json.load(open(a.h1))["items"]; base = json.load(open(a.base))
    side = {"schema": base["schema"], "channels": []}
    have_ids = {r["identifier"] for c in base["channels"] for r in c["rows"]}
    have_ch = {c["id"] for c in base["channels"]}
    rep = {"converted": [], "needsMetadata": [], "alreadyInManifest": [], "unknownCategory": [], "noPlayableRows": [],
           "darkItems": [], "deferredOwnerDecisionItems": 0, "skippedFiles": {}, "deferredFiles": {}}
    for it in h1:
        if it["status"] == DEFER: rep["deferredOwnerDecisionItems"] += 1; continue
        if it["playback"]["type"] != "archive-embed": continue           # direct-file entries were added by patch_centennial.py
        ident, cat = it["identifier"], it["category"]
        if ident in have_ids: rep["alreadyInManifest"].append(ident); continue
        if cat not in VIDEO_TARGET: rep["unknownCategory"].append({"identifier": ident, "category": cat, "status": DEFER}); continue
        p = os.path.join(a.meta_dir, ident + ".json")
        if not os.path.isfile(p): rep["needsMetadata"].append(ident); continue
        meta = json.load(open(p))
        if meta.get("is_dark"): rep["darkItems"].append(ident); continue          # taken down by the Archive: never a row
        chosen, skipped, deferred = pick_files(meta.get("files", []), a.allow_mismatch)
        if skipped: rep["skippedFiles"][ident] = skipped
        if deferred: rep["deferredFiles"][ident] = [{"file": n, "reason": r, "status": DEFER} for n, r in deferred]
        if not chosen["video"] and not chosen["audio"]: rep["noPlayableRows"].append(ident); continue
        mt = (meta.get("metadata") or {}).get("title")
        name = clean_title(str(mt[0] if isinstance(mt, list) else mt) if mt else it["title"])
        for kind, rows_in in chosen.items():
            if not rows_in: continue
            if kind == "video": guide, group = VIDEO_TARGET[cat]; dest, suffix = base, ""
            else: guide, group = AUDIO_GUIDE, AUDIO_GROUP.get(cat, cat); dest, suffix = side, "-audio"
            cid = "h1-" + slug(ident) + suffix
            if cid in have_ch: rep["alreadyInManifest"].append(ident); continue
            rows = [make_row(ident, n, clean_title(os.path.splitext(os.path.basename(n))[0]) or n, sz, sec) for n, sz, sec in rows_in]
            dest["channels"].append({"guideId": guide, "id": cid, "name": name, "group": group, "rows": rows})
            have_ch.add(cid); rep["converted"].append({"identifier": ident, "channel": cid, "kind": kind, "rows": len(rows)})
    problems = [x for x in validate(base) if not x.startswith("duplicate row id")] + ["sidecar: " + x for x in validate(side)]
    rep["validationProblems"] = problems
    dump = lambda obj, path: json.dump(obj, open(path, "w"), ensure_ascii=True, separators=(",", ":"))   # matches original formatting
    dump(base, a.out); dump(side, a.sidecar_out); json.dump(rep, open(a.report, "w"), indent=1)
    print({k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in rep.items()})
    sys.exit(1 if problems else 0)

if __name__ == "__main__":
    main()
