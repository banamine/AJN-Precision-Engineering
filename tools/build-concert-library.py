#!/usr/bin/env python3
"""Live-concert library builder for the Audio & Podcasts guide (source: https://archive.org/details/@paris-portland).

Turns the account's live-concert uploads into a handful of POOLED genre channels ("Live Concerts: Jazz & Blues", ...,
"Live Concerts: Unclassified") instead of one channel per concert, so station numbers (alphabetical, src/guide/channelIndex.ts)
and the guide stay stable no matter how many concerts are added.

  tools/build-concert-library.py --discover          read-only: enumerate + admit + classify, write reports/concert-discovery/*, NO manifest
  tools/build-concert-library.py                     build src/data/concertPoolsManifest.json (needs sources["paris-portland"].enabled == true)

Source of truth for tracks is /metadata/{id} files[] (NOT the *_vbr.m3u, which is a derived file with volatile hostnames).
Admission (fail closed, every rejection has a counted reason): subject has "live concert"; language eng/English (missing language is
excluded and listed under needs_decision unless config includeMissingLanguage); not dark / access-restricted / loan; has >= 1 MP3
(not private, uploaded originals preferred, same rule as server/rush.ts filesFromMetadata) of >= minTrackSeconds; duplicates removed.
Art = the item's own JPEG from files[] (zero extra requests); `none` is an explicit state - never a stand-in image.
Extended write-ups / YouTube links are LOGGED to deferred-metadata.json and never written to the manifest (phase-1 rule).
Archive calls go through the shared paced ArchiveClient (1.55 s/request) and uploader fields are stripped before anything is cached.
Resumable: /metadata responses are cached under --cache; a nightly run only fetches identifiers not in the cache."""
import argparse, hashlib, collections, csv, hashlib, html, importlib.util, json, os, re, sys, urllib.error, urllib.parse
from datetime import datetime, timezone

here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
ACCOUNT = "@paris-portland"
SOURCE_KEY = "paris-portland"
DEFAULTS = {"enabled": False, "subject": "live concert", "languages": ["eng", "english"], "includeMissingLanguage": False,
            "minTrackSeconds": 30, "maxUnclassifiedShare": 0.45, "windowHours": 26}

# ---- genre pools: (id, display genre, regex).  Scored per concert: subject tag x3, title x2, description x1; best score wins (ties -> list order).
POOLS = [
    ("jazz-blues", "Jazz & Blues", r"\bjazz\b|\bblues\b|bebop|big band|swing band|fusion|bossa"),
    ("electronic", "Electronic", r"electronic|techno|trance|\bhouse music\b|ambient|synth|\bidm\b|\bedm\b|drum and bass|dubstep"),
    ("soul-funk-hiphop", "Soul, Funk & Hip-Hop", r"\bsoul\b|\bfunk\b|r&b|rhythm and blues|motown|reggae|\bska\b|hip.?hop|\brap\b|gospel"),
    ("world-latin", "World & Latin", r"\blatin\b|salsa|afro|world music|flamenco|samba|brazil|celtic|reggaeton|mariachi|klezmer"),
    ("folk-country", "Folk, Country & Roots", r"\bfolk\b|\bcountry\b|bluegrass|americana|singer.?songwriter|roots music|\bacoustic\b"),
    ("rock", "Rock", r"\brock\b|punk|metal|grunge|alternative|indie|\bpop\b|new wave|psychedelic|garage|power pop|hard rock"),
]
UNCLASSIFIED = ("unclassified", "Unclassified")
GENRE_RX = [(pid, g, re.compile(rx, re.I)) for pid, g, rx in POOLS]
YT = re.compile(r"https?://(?:www\.)?(?:youtube\.com|youtu\.be)/[^\s\"'<>)]+", re.I)
SPAM_ART = re.compile(r"^www\.", re.I)

def plain(v):
    s = " ".join(str(x) for x in v) if isinstance(v, list) else str(v or "")
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", s))).strip()
def as_list(v):
    return [] if v is None else ([v] if isinstance(v, str) else list(v))
def tidy_title(t):
    return re.sub(r"\s+", " ", plain(t).replace("_", " ")).strip(" -.")
def natkey(n): return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", n)]
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def parse_seconds(v):
    """Archive `length` is either raw seconds ("554.14") or clock text ("02:40", "1:02:03"). Same rule as server/rush.ts seconds()."""
    if isinstance(v, (int, float)): return float(v)
    s = str(v or "").strip()
    if not s: return 0.0
    try:
        if ":" in s:
            t = 0.0
            for p in s.split(":"): t = t * 60 + float(p)
            return t
        return float(s)
    except ValueError:
        return 0.0

def track_no(f):
    m = re.match(r"\s*(\d+)", str(f.get("track") or ""))
    return int(m.group(1)) if m else None

def clean_track_title(f):
    base = str(f.get("title") or "").strip() or os.path.splitext(os.path.basename(f["name"]))[0]
    base = base.replace("_", " ")
    base = re.sub(r"^\s*(?:disc\s*\d+\s*)?(?:track\s*)?\d{1,3}(?:\s*[-._)\]]+\s*|\s+)", "", base, flags=re.I)  # leading "01 ", "1-", "03. "
    return re.sub(r"\s+", " ", base).strip(" -._") or os.path.splitext(os.path.basename(f["name"]))[0]

def select_tracks(meta, min_seconds):
    """MP3s of one item: not private, uploaded originals preferred (derivatives only when that is all there is), >= min_seconds.
    Returns (tracks, dropped_short). Ordered by `track` only when every track has a unique number, else natural filename order."""
    files = [f for f in meta.get("files", []) if re.search(r"\.mp3$", f.get("name", ""), re.I) and str(f.get("private")) != "true"]
    originals = [f for f in files if f.get("source") == "original"]
    chosen = originals or files
    keep, short = [], 0
    for f in chosen:
        d = parse_seconds(f.get("length"))
        if d <= 0: continue
        if d < min_seconds: short += 1; continue
        keep.append(f)
    nums = [track_no(f) for f in keep]
    if keep and all(n is not None for n in nums) and len(set(nums)) == len(nums):
        keep.sort(key=lambda f: (track_no(f), natkey(f["name"])))
    else:
        keep.sort(key=lambda f: natkey(f["name"]))
    return keep, short

def pick_art(meta):
    """Own JPEG from files[]: original 'JPEG' (not thumb, not item tile, not www.* watermark) + its 'JPEG Thumb' derivative. 'none' if absent."""
    jp = [f for f in meta.get("files", []) if re.search(r"\.jpe?g$", f.get("name", ""), re.I) and not f["name"].startswith("__ia_thumb")
          and not SPAM_ART.match(os.path.basename(f["name"])) and "/" not in f["name"]]
    art = sorted([f for f in jp if f.get("format") == "JPEG"], key=lambda f: natkey(f["name"]))
    thumb = sorted([f for f in jp if f.get("format") == "JPEG Thumb"], key=lambda f: natkey(f["name"]))
    return (art[0]["name"] if art else None), (thumb[0]["name"] if thumb else None)

def classify(subjects, title, description):
    """Pool id for one concert. Scored (subject x3, title x2, description[:1500] x1); needs score >= 2 else Unclassified. Deterministic."""
    parts = ((" | ".join(subjects), 3), (title, 2), (description[:1500], 1))
    best, best_score = UNCLASSIFIED[0], 0
    for pid, _g, rx in GENRE_RX:
        score = sum(w * len(rx.findall(txt)) for txt, w in parts if txt)
        # a tag/title hit alone is enough; a lone description mention is not
        if score > best_score and score >= 2: best, best_score = pid, score
    return best

def creator_of(md):
    c = as_list(md.get("creator")); return plain(c[0]) if c else ""

def override_pool(overrides, ident, creator):
    """Owner/reviewed assignment wins over keywords: byIdentifier first, then byCreator (slugged). Unknown pool ids are an error, not ignored."""
    valid = {p[0] for p in POOLS} | {UNCLASSIFIED[0]}
    hit = (overrides.get("byIdentifier") or {}).get(ident) or {slug(k): v for k, v in (overrides.get("byCreator") or {}).items()}.get(slug(creator))
    if hit is not None and hit not in valid: raise ValueError(f"genre override for {ident}/{creator} names unknown pool {hit!r}; valid: {sorted(valid)}")
    return hit

def admission_reason(meta, listing):
    """Item-level rejection reason or None."""
    md = meta.get("metadata", {})
    if meta.get("__ajn_status") == "NOT_FOUND" or not md: return "metadata not found"
    if meta.get("is_dark"): return "dark item"
    if str(md.get("access-restricted-item", "")).lower() == "true": return "access-restricted"
    cols = {c.lower() for c in as_list(md.get("collection"))}
    if cols & {"inlibrary", "lendinglibrary", "printdisabled"}: return "loan/lending collection"
    return None

def dedupe_key(md, tracks):
    return (slug(tidy_title(md.get("title"))), str(md.get("date") or "")[:10])

def build(listing, fetch_meta, cfg, overrides=None, two_pool=None, skip_ids=frozenset()):
    """Pure pipeline over the listing hits. fetch_meta(identifier) -> metadata dict or None. Returns result dict."""
    overrides = overrides or {}
    min_s = cfg["minTrackSeconds"]; wanted = {x.lower() for x in cfg["languages"]}
    funnel = collections.OrderedDict((k, 0) for k in ["account_items", "live_concert_subject", "english", "not_restricted", "playable_mp3", "not_duplicate"])
    rejected = collections.defaultdict(list); needs_decision = collections.defaultdict(list)
    candidates, rows = [], []
    seen_key, seen_md5 = {}, {}; dups = []
    subj_tokens = collections.Counter()
    for hit in sorted(listing, key=lambda h: h["fields"]["identifier"]):
        f = hit["fields"]; ident = f["identifier"]
        if ident in skip_ids: continue   # two-pool additive mode: already in the manifest
        funnel["account_items"] += 1
        subjects = [plain(s) for s in as_list(f.get("subject"))]
        row = {"identifier": ident, "title": tidy_title(f.get("title")), "date": str(f.get("date") or "")[:10],
               "language": ";".join(as_list(f.get("language"))), "subjects": ";".join(subjects), "tracks": "", "art": "", "pool": "", "decision": "", "reason": ""}
        rows.append(row)
        if str(f.get("mediatype")) != "audio": row.update(decision="reject", reason=f"mediatype {f.get('mediatype')}"); rejected[row["reason"]].append(ident); continue
        if not two_pool and cfg["subject"].lower() not in [s.lower() for s in subjects]: row.update(decision="skip", reason="not live concert"); continue
        funnel["live_concert_subject"] += 1
        langs = [l.lower() for l in map(plain, as_list(f.get("language")))]
        if two_pool: pass   # Entry 028/030: every language admitted (language preserved), routing by classifier
        elif not langs:
            if not cfg["includeMissingLanguage"]:
                row.update(decision="needs_decision", reason="language missing"); needs_decision["language_missing"].append(ident); continue
        elif not (set(langs) & wanted):
            row.update(decision="reject", reason="non-English"); rejected["non-English"].append(ident); continue
        funnel["english"] += 1
        meta = fetch_meta(ident)
        reason = admission_reason(meta, f) if meta else "metadata not found"
        if reason: row.update(decision="reject", reason=reason); rejected[reason].append(ident); continue
        funnel["not_restricted"] += 1
        md = meta["metadata"]; tracks, short = select_tracks(meta, min_s)
        if not tracks: row.update(decision="reject", reason="NO_PLAYABLE_AUDIO" if two_pool else "no playable mp3"); rejected["NO_PLAYABLE_AUDIO" if two_pool else "no playable mp3"].append(ident); continue
        funnel["playable_mp3"] += 1
        md5s = frozenset(t["md5"] for t in tracks if t.get("md5"))
        key = dedupe_key(md, tracks)
        dup_of = seen_key.get(key) or next((seen_md5[m] for m in md5s if m in seen_md5), None)
        if dup_of: row.update(decision="duplicate", reason=f"duplicate of {dup_of}"); dups.append({"identifier": ident, "duplicateOf": dup_of}); continue
        seen_key[key] = ident
        for m in md5s: seen_md5.setdefault(m, ident)
        funnel["not_duplicate"] += 1
        title = tidy_title(md.get("title")) or ident; desc = plain(md.get("description"))
        subs = [plain(s) for s in as_list(md.get("subject"))]; subj_tokens.update(s.lower() for s in subs)
        art, thumb = pick_art(meta); creator = creator_of(md)
        pool = override_pool(overrides, ident, creator) or classify(subs, title, desc)
        verdict = two_pool(ident, title, subs, creator, desc) if two_pool else None
        if verdict: row.update(bucket=verdict["bucket"], bucketReason=verdict["reason"])
        row.update(decision="admit", pool=pool, tracks=len(tracks), art="yes" if art else "none", reason=f"{short} short track(s) dropped" if short else "")
        candidates.append({"id": ident, "title": title, "date": str(md.get("date") or "")[:10], "art": art, "thumb": thumb, "pool": pool, "creator": creator,
                           "rights": plain(md.get("licenseurl") or md.get("rights") or ""), "desc": desc, "subjects": subs,
                           "bucket": verdict["bucket"] if verdict else "Live Concerts", "bucketReason": verdict["reason"] if verdict else "", "lang": ";".join(langs),
                           "tracks": [{"f": t["name"], "t": clean_track_title(t), "d": round(parse_seconds(t.get("length"))), "b": int(t["size"]) if t.get("size") else None,
                                       "n": i + 1} for i, t in enumerate(tracks)]})
    return {"funnel": funnel, "candidates": candidates, "rejected": rejected, "needs_decision": needs_decision, "duplicates": dups, "rows": rows, "subject_tokens": subj_tokens}

def pools_manifest(candidates):
    by = collections.defaultdict(list)
    for c in candidates: by[c["pool"]].append(c)
    names = {pid: g for pid, g, _ in POOLS}; names[UNCLASSIFIED[0]] = UNCLASSIFIED[1]
    order = [p[0] for p in POOLS] + [UNCLASSIFIED[0]]
    pools = []
    for pid in order:
        cs = sorted(by.get(pid, []), key=lambda c: (c["date"], c["id"]))
        if not cs: continue
        pools.append({"id": f"concert-pool-{pid}", "name": f"Live Concerts: {names[pid]}", "group": "Live Concerts", "genre": names[pid],
                      "concerts": [{"id": c["id"], "title": c["title"], "date": c["date"], "art": c["art"], "thumb": c["thumb"],
                                    "tracks": [{k: v for k, v in t.items() if v is not None} for t in c["tracks"]]} for c in cs]})
    return {"schema": "ajn.concertPools.v1", "source": ACCOUNT, "pools": pools}

SPECIAL = re.compile(r"[#&%'()\[\]+;=,!]")
def stratified_sample(candidates, n):
    """Deterministic vertical-slice sample: every pool present, quota ~proportional (min 1),
    plus up to 3 concerts whose filenames contain URL-special characters (proxy-encoding stress).
    Not alphabetical: members are picked by a stable hash so one artist does not dominate."""
    by = collections.defaultdict(list)
    for c in candidates: by[c["pool"]].append(c)
    h = lambda c: hashlib.sha1(c["id"].encode()).hexdigest()
    pools = sorted(by); total = sum(len(v) for v in by.values())
    quota = {p: max(1, round(n * len(by[p]) / total)) for p in pools}
    while sum(quota.values()) > n:
        quota[max(quota, key=quota.get)] -= 1
    while sum(quota.values()) < n:
        quota[max(pools, key=lambda p: len(by[p]) - quota[p])] += 1
    chosen = {}
    special = sorted((c for c in candidates if any(SPECIAL.search(t["f"]) for t in c["tracks"])), key=h)[:3]
    for c in special: chosen[c["id"]] = c
    for p in pools:
        have = [c for c in chosen.values() if c["pool"] == p]
        for c in sorted(by[p], key=h):
            if len(have) >= quota[p]: break
            if c["id"] not in chosen: chosen[c["id"]] = c; have.append(c)
    return sorted(chosen.values(), key=lambda c: (c["pool"], c["id"]))

def deferred_metadata(candidates):
    out = []
    for c in candidates:
        links = sorted(set(YT.findall(c["desc"])))
        if links or len(c["desc"]) > 400:
            out.append({"identifier": c["id"], "descriptionChars": len(c["desc"]), "youtubeLinks": links})
    return out

# ---- I/O ----
def load_infobattalion_module():
    s = importlib.util.spec_from_file_location("ajn_ib_lists", os.path.join(here, "build-infobattalion-lists.py"))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

def enumerate_account(ib):
    """All uploads via the page_production account_details call (creator:@handle / uploader:@handle are NOT valid searches)."""
    out, pg = [], 1
    while True:
        q = urllib.parse.urlencode({"user_query": "", "page_type": "account_details", "page_target": ACCOUNT, "hits_per_page": 100, "page": pg})
        h = ib.jget("https://archive.org/services/search/beta/page_production/?" + q)["response"]["body"]["page_elements"]["uploads"]["hits"]
        out += h["hits"]
        if len(out) >= h["total"] or not h["hits"]: return out
        pg += 1

def make_fetcher(ib, cache_dir, errors):
    os.makedirs(cache_dir, exist_ok=True)
    def fetch(ident):
        p = os.path.join(cache_dir, urllib.parse.quote(ident, safe="") + ".json")
        if os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
        try:
            data = ib.jget("https://archive.org/metadata/" + urllib.parse.quote(ident, safe=""))
        except urllib.error.HTTPError as e:
            if e.code == 404: data = {"__ajn_status": "NOT_FOUND"}
            else: errors.append(f"{ident}: HTTP {e.code}"); return None   # not cached: retried next run, never counted as success
        except ib.ArchiveFetchStopped as e:
            errors.append(f"{ident}: {e}"); raise
        except Exception as e:
            errors.append(f"{ident}: {type(e).__name__}"); return None
        if not data.get("files") and data.get("__ajn_status") != "NOT_FOUND":  # empty answer is not success
            errors.append(f"{ident}: empty metadata"); return None
        json.dump(data, open(p + ".tmp", "w", encoding="utf-8"), ensure_ascii=False); os.replace(p + ".tmp", p)
        return data
    return fetch

def write_reports(out_dir, res, manifest, gen):
    os.makedirs(out_dir, exist_ok=True)
    cands = res["candidates"]; total = res["funnel"]["live_concert_subject"]
    pool_counts = collections.Counter(c["pool"] for c in cands)
    track_total = sum(len(c["tracks"]) for c in cands)
    with open(os.path.join(out_dir, "candidates.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["identifier", "title", "date", "language", "subjects", "tracks", "art", "pool", "decision", "reason"]); w.writeheader(); w.writerows(res["rows"])
    json.dump({k: sorted(v) for k, v in res["rejected"].items()}, open(os.path.join(out_dir, "rejected.json"), "w"), indent=1)
    json.dump({k: sorted(v) for k, v in res["needs_decision"].items()}, open(os.path.join(out_dir, "needs-decision.json"), "w"), indent=1)
    json.dump(res["duplicates"], open(os.path.join(out_dir, "duplicates.json"), "w"), indent=1)
    json.dump(deferred_metadata(cands), open(os.path.join(out_dir, "deferred-metadata.json"), "w"), indent=1)
    with open(os.path.join(out_dir, "unclassified-for-review.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["identifier", "creator", "title", "date", "assign_pool_id"])
        w.writerows([c["id"], c["creator"], c["title"], c["date"], ""] for c in sorted(cands, key=lambda c: (c["creator"].lower(), c["id"])) if c["pool"] == UNCLASSIFIED[0])
    with open(os.path.join(out_dir, "genre-tokens.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["subject_token", "count"]); w.writerows(res["subject_tokens"].most_common())
    mb = len(json.dumps(manifest, separators=(",", ":")).encode()) if manifest else 0
    un = pool_counts.get(UNCLASSIFIED[0], 0)
    lines = [f"# Concert library discovery - {ACCOUNT}", f"Generated {gen}. Archive requests via shared paced client.", "", "## Funnel (must decrease monotonically)", "| step | items |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in res["funnel"].items()]
    rej = [f"- {k}: {len(v)}" for k, v in sorted(res["rejected"].items())] or ["- none"]
    nd = [f"- {k}: {len(v)} (see needs-decision.json)" for k, v in sorted(res["needs_decision"].items())] or ["- none"]
    lines += ["", "## Rejections", *rej, "", "## Needs decision", *nd,
              "", f"## Pools ({len(cands)} concerts, {track_total} tracks)", "| pool | concerts |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in sorted(pool_counts.items(), key=lambda kv: -kv[1])]
    lines += ["", f"Unclassified share: {100*un/max(1,len(cands)):.1f}% of admitted concerts", f"Duplicates removed: {len(res['duplicates'])}",
              f"Concerts without art (explicit 'none'): {sum(1 for c in cands if not c['art'])}",
              f"Deferred write-ups/YouTube logged (not ingested): {len(deferred_metadata(cands))}",
              f"Manifest size (compact JSON): {mb:,} bytes" if mb else "Manifest not built in this mode."]
    open(os.path.join(out_dir, "summary.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return un / max(1, len(cands))

def merge_pools(existing, new_manifest):
    """Append new concerts to existing pools (by pool id); existing concerts are never rewritten or reordered out of place."""
    by = {p["id"]: p for p in existing["pools"]}; seen = {c["id"] for p in existing["pools"] for c in p["concerts"]}
    order = [p["id"] for p in existing["pools"]]
    for np_ in new_manifest["pools"]:
        add = [c for c in np_["concerts"] if c["id"] not in seen]
        if not add: continue
        if np_["id"] in by: by[np_["id"]]["concerts"] = sorted(by[np_["id"]]["concerts"] + add, key=lambda c: (c["date"], c["id"]))
        else: by[np_["id"]] = dict(np_, concerts=add); order.append(np_["id"])
        seen.update(c["id"] for c in add)
    return dict(existing, pools=[by[i] for i in order])

def fm_manifest(cands):
    rows = [{"id": c["id"], "title": c["title"], "date": c["date"], "art": c["art"], "thumb": c["thumb"], "creator": c["creator"], "lang": c["lang"], "reason": c["bucketReason"],
             "tracks": [{k: v for k, v in t.items() if v is not None} for t in c["tracks"]]} for c in sorted(cands, key=lambda c: (c["date"], c["id"]))]
    return {"schema": "ajn.fmBroadcasts.v1", "source": ACCOUNT, "group": "FM Broadcasts", "broadcasts": rows}

def run_two_pool(a, cfg, ib, listing, errors, overrides):
    """Entry 028/030/032: additive two-pool ingest. Existing manifest concerts are skipped (never rewritten); no silent defaults - every item carries a reason."""
    sys.path.insert(0, here); import paris_portland_classifier as ppc
    existing = json.load(open(a.out, encoding="utf-8")); have = {c["id"] for p in existing["pools"] for c in p["concerts"]}
    res = build(listing, make_fetcher(ib, a.cache, errors), cfg, overrides, two_pool=ppc.classify_final, skip_ids=frozenset(have))
    os.makedirs(a.reports, exist_ok=True)
    cols = ["identifier", "title", "language", "subjects", "tracks", "art", "pool", "bucket", "bucketReason", "decision", "reason"]
    with open(os.path.join(a.reports, "paris-portland-two-pool.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(res["rows"])
    live = [c for c in res["candidates"] if c["bucket"] == "Live Concerts"]; fm = [c for c in res["candidates"] if c["bucket"] == "FM Broadcasts"]
    summary = {"alreadyInManifestSkipped": len(have & {h["fields"]["identifier"] for h in listing}), "newLiveConcerts": len(live), "newFmBroadcasts": len(fm),
               "duplicatesRemoved": len(res["duplicates"]), "rejected": {k: len(v) for k, v in res["rejected"].items()}, "fetchErrors": len(errors),
               "reasons": dict(collections.Counter(c["bucketReason"].split(":")[0] for c in res["candidates"])),
               "auditFlagged": sorted(c["id"] for c in res["candidates"] if c["bucketReason"] == "AUDIT_REVIEW_UNVERIFIED_VENUE"),
               "nonEnglishOrMissingLanguageAdmitted": sum(1 for c in live if not ({x.lower() for x in c["lang"].split(";")} & {"eng", "english"}))}
    json.dump(summary, open(os.path.join(a.reports, "paris-portland-two-pool-summary.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    if errors: print("Refusing to write manifests from an incomplete fetch:", errors[:3], file=sys.stderr); return 4
    merged = merge_pools(existing, pools_manifest(live))
    for path, obj in ((a.out, merged), (a.fm_out, fm_manifest(fm))):
        tmp = path + ".tmp"; json.dump(obj, open(tmp, "w", encoding="ascii"), separators=(",", ":"), ensure_ascii=True); os.replace(tmp, path); print("wrote", path)
    return 0

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--discover", action="store_true", help="read-only: reports only, no manifest, ignores enabled flag")
    ap.add_argument("--config", default=os.path.join(root, "config/catalog-refresh.json"))
    ap.add_argument("--cache", default=os.path.join(root, ".cache/concert-library"))
    ap.add_argument("--out", default=os.path.join(root, "src/data/concertPoolsManifest.json"))
    ap.add_argument("--reports", default=os.path.join(root, "reports/concert-discovery"))
    ap.add_argument("--overrides", default=os.path.join(root, "config/concert-genre-overrides.json"))
    ap.add_argument("--listing", help="saved uploads listing JSON instead of fetching (tests/offline)")
    ap.add_argument("--limit", type=int, default=0, help="only the first N identifiers after sorting (staged backfill: 25, 100, all)")
    ap.add_argument("--stage-sample", type=int, default=0, help="also write a stratified N-concert staging manifest (see --stage-out); production manifest unaffected")
    ap.add_argument("--stage-out", default=os.path.join(root, "reports/concert-discovery/concertPoolsManifest.staging.json"))
    ap.add_argument("--two-pool", action="store_true", help="Entry 028/030/032: additive Paris-Portland ingest. Classify each NEW item (tools/paris_portland_classifier.py) into Live Concerts "
                    "(merged into --out, existing concerts untouched) or FM Broadcasts (--fm-out). Reads --listing + --cache only; no network when both are complete.")
    ap.add_argument("--fm-out", default=os.path.join(root, "src/data/fmBroadcastChannels.json"))
    ap.add_argument("--accept-unclassified", action="store_true", help="write the manifest even when Unclassified exceeds maxUnclassifiedShare")
    a = ap.parse_args(argv)
    cfg = dict(DEFAULTS)
    with open(a.config, encoding="utf-8") as fh: cfg.update(json.load(fh).get("sources", {}).get(SOURCE_KEY, {}))
    if not a.discover and not (a.two_pool and a.listing) and cfg.get("enabled") is not True:   # --two-pool needs an explicit saved --listing (offline), so the fail-closed network gate is not bypassed
        print(f"{SOURCE_KEY} is disabled in config (fail-closed). Run --discover, or set sources.{SOURCE_KEY}.enabled=true.", file=sys.stderr); return 2
    ib = load_infobattalion_module(); errors = []
    if a.listing:
        with open(a.listing, encoding="utf-8") as fh: listing = json.load(fh)
    else: listing = enumerate_account(ib)
    if a.limit:
        ids = sorted(h["fields"]["identifier"] for h in listing if cfg["subject"].lower() in [plain(s).lower() for s in as_list(h["fields"].get("subject"))])[:a.limit]
        listing = [h for h in listing if h["fields"]["identifier"] in set(ids)]
    overrides = {}
    if os.path.exists(a.overrides):
        with open(a.overrides, encoding="utf-8") as fh: overrides = json.load(fh)
    if a.two_pool:
        return run_two_pool(a, cfg, ib, listing, errors, overrides)
    res = build(listing, make_fetcher(ib, a.cache, errors), cfg, overrides)
    manifest = pools_manifest(res["candidates"])
    share = write_reports(a.reports, res, None if a.discover else manifest, datetime.now(timezone.utc).isoformat(timespec="seconds"))
    if errors:
        open(os.path.join(a.reports, "fetch-errors.txt"), "w").write("\n".join(errors) + "\n")
        print(f"{len(errors)} metadata fetch error(s) - not cached, not counted as success; see fetch-errors.txt", file=sys.stderr)
    print(json.dumps({"funnel": res["funnel"], "pools": {p["id"]: len(p["concerts"]) for p in manifest["pools"]}, "unclassifiedShare": round(share, 3), "fetchErrors": len(errors)}, indent=1))
    if a.discover: return 0
    if errors: print("Refusing to write a manifest from an incomplete fetch.", file=sys.stderr); return 4
    if share > cfg["maxUnclassifiedShare"] and not a.accept_unclassified:
        print(f"Unclassified share {share:.0%} > {cfg['maxUnclassifiedShare']:.0%}: owner decision needed (genre map). Manifest NOT written.", file=sys.stderr); return 3
    if a.stage_sample:
        sm = pools_manifest(stratified_sample(res["candidates"], a.stage_sample))
        os.makedirs(os.path.dirname(a.stage_out), exist_ok=True)
        json.dump(sm, open(a.stage_out, "w", encoding="ascii"), separators=(",", ":"), ensure_ascii=True)
        print("wrote staging sample", a.stage_out, {p["id"]: len(p["concerts"]) for p in sm["pools"]})
    if not manifest["pools"]: print("No pools: refusing to write an empty manifest as success.", file=sys.stderr); return 5
    tmp = a.out + ".tmp"; json.dump(manifest, open(tmp, "w", encoding="ascii"), separators=(",", ":"), ensure_ascii=True); os.replace(tmp, a.out)
    print("wrote", a.out)
    return 0

if __name__ == "__main__": sys.exit(main())
