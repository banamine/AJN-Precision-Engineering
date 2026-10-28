#!/usr/bin/env python3
"""Add the NEW members of the @infobattalion Archive lists (and two Movies result pages) to their contracts.
Lists (https://archive.org/services/users/@infobattalion/lists): 1 Documentary, 2 Music, 3 Cartoons, 4 Tv Classics, 5 Movies Classics,
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
import argparse, glob, hashlib, importlib.util, json, os, re, threading, time, urllib.parse, urllib.request, urllib.error, concurrent.futures as cf
from datetime import datetime, timezone
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
def load(name):
    s = importlib.util.spec_from_file_location(name, os.path.join(here, name + ".py")); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
org = load("build-organizer-manifest") if False else None
def _load(fn):
    s = importlib.util.spec_from_file_location(fn.replace("-", "_"), os.path.join(here, fn + ".py")); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
org = _load("build-organizer-manifest"); xc = _load("build-extra-channels-manifest")
UA = {"User-Agent": "AJN-Precision-Engineering infobattalion catalog builder/1.0"}

class ArchiveFetchStopped(RuntimeError):
    pass

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class ArchiveClient:
    """Serialize Archive request starts and keep a local physical-request ledger."""
    def __init__(self, interval=1.55, opener=None, clock=None, sleeper=None):
        self.interval = interval
        self.opener = opener or urllib.request.build_opener(NoRedirectHandler()).open
        self.clock = clock or time.monotonic
        self.sleeper = sleeper or time.sleep
        self._start_lock = threading.Lock()
        self._ledger_lock = threading.Lock()
        self._last_start = None
        self._stopped = False
        self.ledger_path = None

    def _ledger(self, record):
        if not self.ledger_path: return
        record["recordedAt"] = datetime.now(timezone.utc).isoformat()
        with self._ledger_lock, open(self.ledger_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")

    def _start(self, url, attempt):
        with self._start_lock:
            if self._stopped:
                raise ArchiveFetchStopped("Archive requests stopped after a rate-limit/service response")
            now = self.clock()
            if self._last_start is not None:
                wait = self.interval - (now - self._last_start)
                if wait > 0: self.sleeper(wait)
            started = self.clock()
            self._last_start = started
            self._ledger({"event": "start", "startedMonotonic": started, "url": url, "attempt": attempt})
            return started

    def get(self, url):
        for attempt in range(1, 4):
            target = url
            for hop in range(6):
                started = self._start(target, attempt)
                req = urllib.request.Request(target, headers=UA)
                try:
                    with self.opener(req, timeout=120) as response:
                        body = response.read()
                        status = getattr(response, "status", 200)
                    self._ledger({"event": "result", "startedMonotonic": started, "url": target, "attempt": attempt,
                                  "redirectHops": hop, "status": status})
                    return body
                except urllib.error.HTTPError as error:
                    retry_after = error.headers.get("Retry-After") if error.headers else None
                    if error.code in (301, 302, 303, 307, 308):
                        location = error.headers.get("Location") if error.headers else None
                        redirect = urllib.parse.urljoin(target, location or "")
                        parts = urllib.parse.urlsplit(redirect)
                        if not location or parts.scheme != "https" or not (parts.hostname == "archive.org" or (parts.hostname or "").endswith(".archive.org")):
                            self._ledger({"event": "result", "startedMonotonic": started, "url": target, "attempt": attempt,
                                          "status": error.code, "redirectBlocked": redirect})
                            raise ArchiveFetchStopped("Archive redirect missing or outside HTTPS Archive hosts")
                        self._ledger({"event": "redirect", "startedMonotonic": started, "from": target, "to": redirect,
                                      "attempt": attempt, "hop": hop + 1, "status": error.code})
                        target = redirect
                        continue
                    self._ledger({"event": "result", "startedMonotonic": started, "url": target, "attempt": attempt,
                                  "status": error.code, "retryAfter": retry_after})
                    if error.code in (429, 503) or retry_after:
                        with self._start_lock: self._stopped = True
                        raise ArchiveFetchStopped(f"Archive returned HTTP {error.code}; Retry-After={retry_after or 'none'}; stopping fetch") from error
                    if error.code >= 500 and attempt < 3:
                        break
                    raise
                except (urllib.error.URLError, TimeoutError, OSError) as error:
                    self._ledger({"event": "result", "startedMonotonic": started, "url": target, "attempt": attempt,
                                  "status": "network_error", "error": type(error).__name__})
                    if attempt == 3: raise
                    break
            else:
                raise ArchiveFetchStopped("Archive redirect limit exceeded")
        raise RuntimeError("Archive request attempts exhausted")

ARCHIVE = ArchiveClient()

def archive_download(url, dest):
    data = ARCHIVE.get(url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest + ".tmp", "wb") as f: f.write(data)
    os.replace(dest + ".tmp", dest)

# Metadata calls from the shared organizer helper use the same paced client.
org.http_get = archive_download

def jget(url):
    return json.loads(ARCHIVE.get(url).decode("utf-8"))
def page(**p):
    return jget("https://archive.org/services/search/beta/page_production/?" + urllib.parse.urlencode(p))["response"]["body"]

SKIP_TV = re.compile(r"wwf|wrestl|full-fight|honbasho|survivor|bonus-content|bitchute_|fxm-retro|judge-judy|dvd-transfer|freedownloadvideo|-woc$|^bobbygallery$|^bobbyellery$", re.I)
SKIP_DOC = re.compile(r"$^")
CYR = re.compile("[\u0400-\u04ff]")
SEX = re.compile(r"\bsex\b", re.I)
def cut(s, n=60):
    return s if len(s) <= n else (s[:n].rsplit(" ", 1)[0] if " " in s[:n] else s[:n])
TVISH = re.compile(r"\bs\d{1,2}\s?e\d{1,3}\b|\bseason \d+|\bepisode \d+|\b\d{1,2}x\d{2}\b|60 minutes|abc news|nightline|\bpart \d+ of \d+", re.I)
EPISODE_MIN_SECONDS = 600     # same floor as the Tv Classics list
MOVIE_MIN_SECONDS = 2700      # films >= 45 min
def is_test_file(path):
    """Test files name identifiers to assert on them; that must not count as the item being in the app."""
    base = os.path.basename(path)
    return base.startswith(("test-", "test_")) or ".test." in base
def classify_movie_list_item(movie_rows, episode_rows):
    """Pure. A Movies-list item with at least one feature-length, non-episode file stays a movie.
    One with none, but with 2+ episode-like files (TV-style title or 10-45 min long), is a TV show and goes to Classic TV.
    Anything else is dropped (and reported)."""
    if movie_rows:
        return "movie", movie_rows
    episodic = [r for r in episode_rows if TVISH.search(r["title"]) or r["durationSeconds"] < MOVIE_MIN_SECONDS]
    if len(episodic) >= 2:
        return "tv", episodic
    return "none", []
def tidy_title(t):
    t = re.sub(r"^\d{8} - [A-Za-z0-9_-]{8,} - ", "", t or ""); t = re.sub(r"\.ia$", "", t.strip(), flags=re.I)
    t = re.sub(r"\s*\{imdb-tt\d+\}", "", t); return re.sub(r"\s+", " ", t).strip(" -.")
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]
SOURCE_GUIDES = {
    "documentary": "science-documentaries",
    "cartoons": "classic-tv",
    "tv": "classic-tv",
    "movies": "movies-classics-vault",
    "opensource": "movies-classics-vault",
    "atlas": "movies-classics-vault",
    "nwt": "cable-tv",
    "otr": "audio-podcasts",
    "music": "audio-podcasts",
}

def manifest_guides(extra, docs, audio):
    """Map canonical Archive identifiers to every guide already containing them."""
    guides = {}
    def add(identifier, guide):
        if isinstance(identifier, str) and identifier.strip():
            guides.setdefault(identifier.strip().lower(), set()).add(guide)
    for channel in extra.get("channels", []):
        for row in channel.get("rows", []):
            add(row.get("identifier"), channel.get("guideId", ""))
    for entry in docs if isinstance(docs, list) else []:
        add(entry.get("id"), "science-documentaries")
    for entry in audio if isinstance(audio, list) else []:
        add(entry.get("itemId"), "audio-podcasts")
    return guides

def generated_channel(c):
    return c.get("id", "").startswith(("tvx-", "cx-")) or c.get("id") in (
        "mx-movies-classics-list", "mx-filmography", "mx-atlas-taggart", "ajn-new-world-tyranny"
    )

def should_defer_light_rows(channel_id, previous_ids, previously_deferred, requested):
    return channel_id in previously_deferred or (requested and channel_id not in previous_ids)

def manifest_channel(guide, channel_id, name, group, rows, defer_light_rows=False):
    entry = {"guideId": guide, "id": channel_id, "name": name, "group": group, "rows": rows}
    if defer_light_rows:
        entry["deferLightRows"] = True
    return entry

def ungenerated_payload(path, payload, extra_path, docs_path, audio_path):
    target = os.path.realpath(path)
    if target == os.path.realpath(extra_path):
        return {**payload, "channels": [c for c in payload["channels"] if not generated_channel(c)]}
    if target in (os.path.realpath(docs_path), os.path.realpath(audio_path)) and isinstance(payload, list):
        return [entry for entry in payload if not entry.get("_ib")]
    return payload
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

def cartoon_channels(shows):
    """Build Cartoons-group channels from (identifier, title, rows) without title-based classification."""
    channels, singles, used = [], [], set()
    rejected = {}
    def reject(reason, count=1): rejected[reason] = rejected.get(reason, 0) + count
    for ident, title, rows in shows:
        kept = []
        for row in rows:
            if row.get("durationSeconds", 0) < 30:
                reject("duration_under_30_seconds")
            elif row.get("bytes", 0) < 100_000:
                reject("size_under_100kb")
            else:
                kept.append(row)
        if not kept:
            reject("no_eligible_rows")
        elif len(kept) >= 3:
            base = slug(clean(title) or ident) or slug(ident)
            cid = "cx-" + base
            if cid in used or cid == "cx-classic-cartoons":
                cid = "cx-" + slug(ident) + "-" + hashlib.sha256(ident.encode()).hexdigest()[:8]
            used.add(cid)
            channels.append({"guideId": "classic-tv", "id": cid, "name": cut(clean(title) or ident),
                             "group": "Cartoons", "rows": kept})
        else:
            singles.extend(kept)
    if singles:
        channels.append({"guideId": "classic-tv", "id": "cx-classic-cartoons", "name": "Classic Cartoons",
                         "group": "Cartoons", "rows": singles})
    return channels, rejected

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache", required=True); ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--extra", default="src/data/extraChannelsManifest.json"); ap.add_argument("--docs", default="src/data/documentariesManifest.json")
    ap.add_argument("--audio", default="src/data/archiveAudioChannels.json"); ap.add_argument("--report", default="reports/infobattalion-lists.json")
    ap.add_argument("--existing-classic", default=None, help="saved /api/schedule?guide=classic-tv JSON, used to skip shows that already have a channel")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.cache, "meta"), exist_ok=True)
    ARCHIVE.ledger_path = os.path.join(a.cache, "request-ledger.jsonl")
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
    list_ids = (("documentary", 1), ("music", 2), ("cartoons", 3), ("tv", 4), ("movies", 5), ("nwt", 6), ("otr", 10))
    list_member_counts = {n: len(L[i]["members"]) for n, i in list_ids}
    lists = {n: list(dict.fromkeys(m["identifier"] for m in L[i]["members"])) for n, i in list_ids}
    lists["opensource"] = [x["identifier"] for x in os_items]; lists["atlas"] = [x["identifier"] for x in atlas_items]
    if a.fetch:
        ids = list(dict.fromkeys(i for v in lists.values() for i in v))
        def one(i):
            f = os.path.join(a.cache, "meta", org.md5id(i) + ".json")
            if not os.path.exists(f): org.http_get("https://archive.org/metadata/" + urllib.parse.quote(i, safe=""), f)
        with cf.ThreadPoolExecutor(8) as ex: list(ex.map(one, ids))
        if ARCHIVE._stopped:
            raise ArchiveFetchStopped("Archive fetch stopped; no manifests were written")
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
    generated_paths = {
        os.path.realpath(os.path.join(root, a.extra)),
        os.path.realpath(os.path.join(root, a.docs)),
        os.path.realpath(os.path.join(root, a.audio)),
    }
    manifest_payloads = {path: json.load(open(path)) for path in generated_paths}
    existing_manifest_guides = manifest_guides(
        manifest_payloads[os.path.realpath(os.path.join(root, a.extra))],
        manifest_payloads[os.path.realpath(os.path.join(root, a.docs))],
        manifest_payloads[os.path.realpath(os.path.join(root, a.audio))],
    )
    for pat in ("src/data/*.json", "*.ts", "collections/*.ts", "server/**/*.ts", "src/**/*.ts*"):
        for f in glob.glob(os.path.join(root, pat), recursive=True):
            # libraryIndex/archiveCatalog are the Library SEARCH index, not guides: an item found only there is NOT on any channel.
            if os.path.basename(f) in ("libraryIndex.json", "archiveCatalog.json"): continue
            if is_test_file(f): continue
            if os.path.realpath(f) in generated_paths:
                current = ungenerated_payload(f, manifest_payloads[os.path.realpath(f)], a.extra, a.docs, a.audio)
                txt += json.dumps(current).lower()
            else:
                txt += open(f, errors="ignore").read().lower()
    inapp = lambda i: i.lower() in txt
    existing = set()
    if a.existing_classic and os.path.exists(a.existing_classic):
        existing = {norm(c["name"]) for c in json.load(open(a.existing_classic))["channels"]}
    report = {"skipped_in_app": {}, "dark": {}, "excluded": {}, "channels": {}, "needs_decision": {}}
    list_stats = {n: {"members": list_member_counts.get(n, len(ids)), "unique_members": len(ids), "added_ids": set(), "added_rows": 0, "skipped_already_in_app": 0,
                      "skipped_claimed": 0, "rejected": {}} for n, ids in lists.items()}
    def reject_list(name, reason, count=1):
        stats = list_stats[name]["rejected"]
        stats[reason] = stats.get(reason, 0) + count
    def record_rows(name, rows):
        stats = list_stats[name]
        stats["added_rows"] += len(rows)
        stats["added_ids"].update(r["identifier"] for r in rows)
    claimed = set()
    def pick_new(name):
        out = []
        for i in lists[name]:
            target_guide = SOURCE_GUIDES.get(name)
            current_guides = existing_manifest_guides.get(i.lower(), set())
            if target_guide and any(guide != target_guide for guide in current_guides):
                report["skipped_in_app"].setdefault(name + "_already_in_other_guide", []).append(i)
                list_stats[name]["skipped_already_in_app"] += 1
                continue
            if i.lower() in claimed:
                report["skipped_in_app"].setdefault(name + "_claimed_by_earlier_list", []).append(i)
                list_stats[name]["skipped_claimed"] += 1
                continue
            it = meta.get(i)
            if not it or it["state"] != "ok":
                report["dark"].setdefault(name, []).append(i)
                reject_list(name, "dark_or_metadata_missing")
                continue
            if inapp(i):
                report["skipped_in_app"].setdefault(name, []).append(i)
                list_stats[name]["skipped_already_in_app"] += 1
                continue
            out.append(i)
        return out
    extra = json.load(open(os.path.join(root, a.extra)))
    previous_channel_ids = {c.get("id") for c in extra.get("channels", []) if c.get("id")}
    previously_deferred = {c.get("id") for c in extra.get("channels", []) if c.get("id") and c.get("deferLightRows") is True}
    chans = [c for c in extra["channels"] if not generated_channel(c)]
    def add(guide, cid, name, group, rows, note="", defer_light_rows=False):
        if not rows: return
        defer = should_defer_light_rows(cid, previous_channel_ids, previously_deferred, defer_light_rows)
        chans.append(manifest_channel(guide, cid, name, group, rows, defer))
        claimed.update(r["identifier"].lower() for r in rows)
        report["channels"][cid] = {"guide": guide, "name": name, "rows": len(rows), "hours": round(sum(r["durationSeconds"] for r in rows) / 3600), "note": note}
    def rows_for(idents, min_len=0, movies=False, source_list=None):
        rows, dropped = xc.item_rows([(i, title_of(i)) for i in idents], meta, min_len=min_len)
        if source_list:
            for reason, count in dropped.items(): reject_list(source_list, reason, count)
        for r in rows: r["title"] = tidy_title(r["title"])
        keep = [r for r in rows if not SEX.search(r["title"]) and not (movies and TVISH.search(r["title"]))]
        if source_list and len(keep) != len(rows):
            reject_list(source_list, "title_filter", len(rows) - len(keep))
        if movies and len(keep) != len([r for r in rows if not SEX.search(r["title"])]): report["excluded"]["tv_episodes_in_movie_lists"] = report["excluded"].get("tv_episodes_in_movie_lists", 0) + len([r for r in rows if not SEX.search(r["title"])]) - len(keep)
        if len(keep) != len(rows): report["excluded"]["sex_whole_word_rows"] = report["excluded"].get("sex_whole_word_rows", 0) + len(rows) - len(keep)
        return keep, dropped
    # ---- Movies
    # Each Movies-list item is classified on its own: feature films stay in Movies; items whose files are
    # TV episodes (TV-style titles, or 10-45 min files) move to Classic TV below instead of being dropped.
    movie_rows, movie_list_tv = [], []
    report["movies_rerouted_to_tv"] = []
    report["movies_list_dropped"] = []
    for i in pick_new("movies"):
        full, _ = rows_for([i], MOVIE_MIN_SECONDS, True, source_list="movies")
        eps, _ = rows_for([i], EPISODE_MIN_SECONDS)
        kind, rows = classify_movie_list_item(full, eps)
        if kind == "movie":
            movie_rows += rows
        elif kind == "tv":
            title = clean(title_of(i)) or i
            movie_list_tv.append((i, title, rows))
            claimed.add(i.lower())
            report["movies_rerouted_to_tv"].append({"identifier": i, "title": title, "rows": len(rows),
                                                    "sample": [r["title"] for r in rows[:3]]})
        else:
            report["movies_list_dropped"].append({"identifier": i, "title": title_of(i), "episodeLikeRows": len(eps)})
    record_rows("movies", movie_rows)
    add("movies-classics-vault", "mx-movies-classics-list", "Movies Classics (list)", "Movies", movie_rows,
        "list 5, new items only; films >= 45 min; TV-episode items moved to Classic TV")
    # ---- Cartoons (list 3; ahead of generic filmography/other sources so cartoons keep their requested group)
    cartoon_shows = []
    for i in pick_new("cartoons"):
        rs, _ = rows_for([i], 30, source_list="cartoons")
        title = clean(title_of(i)) or i
        cartoon_shows.append((i, title, rs))
    cartoon_chans, cartoon_rejected = cartoon_channels(cartoon_shows)
    for reason, count in cartoon_rejected.items(): reject_list("cartoons", reason, count)
    for channel in cartoon_chans:
        add(channel["guideId"], channel["id"], channel["name"], channel["group"], channel["rows"], "owner list 3; eligible Archive episodes", defer_light_rows=True)
        record_rows("cartoons", channel["rows"])
    r, d = rows_for(pick_new("opensource"), 2700, True); add("movies-classics-vault", "mx-filmography", "Filmography Collection", "Movies", r, "opensource_movies query filmography; full movie + english sub")
    r, d = rows_for(pick_new("atlas"), 1500, True); add("movies-classics-vault", "mx-atlas-taggart", "Atlas Taggart Picks", "Movies", r, "@atlas_taggart826; full movie + english sub")
    # ---- New World Tyranny (video -> Cable TV; mp3 -> audio channels below)
    r, d = rows_for(pick_new("nwt"), 60); add("cable-tv", "ajn-new-world-tyranny", "NEW WORLD TYRANNY", "News", r, "list 6, video items")
    # ---- Classic TV
    tv_own, tv_single = [], []
    for i in pick_new("tv"):
        if SKIP_TV.search(i):
            report["excluded"].setdefault("tv", []).append(i)
            reject_list("tv", "identifier_exclusion")
            continue
        rs, dropped = rows_for([i], 600, source_list="tv")
        if not rs:
            report["excluded"].setdefault("tv_no_playable_runtime", []).append(i)
            reject_list("tv", "no_playable_runtime")
            continue
        nm = clean(title_of(i)) or i
        if norm(nm) and norm(nm) in existing:
            report["skipped_in_app"].setdefault("tv_same_name_channel", []).append(i)
            list_stats["tv"]["skipped_already_in_app"] += 1
            continue
        (tv_own if len(rs) >= 3 else tv_single).append((i, nm, rs))
    # TV shows found on the Movies list (classified above) join the Tv Classics additions.
    for i, nm, rs in movie_list_tv:
        if norm(nm) and norm(nm) in existing:
            report["skipped_in_app"].setdefault("movies_tv_same_name_channel", []).append(i)
            continue
        (tv_own if len(rs) >= 3 else tv_single).append((i, nm, rs))
    used = set()
    for i, nm, rs in tv_own:
        cid = "tvx-" + slug(i if slug(nm) in used else nm); used.add(slug(nm))
        add("classic-tv", cid, cut(nm), "Classic TV", rs, f"item {i}", defer_light_rows=True)
        record_rows("tv", rs)
    if tv_single:
        single_rows = [x for _, _, rs in tv_single for x in rs]
        add("classic-tv", "tvx-specials-and-singles", "Classic TV Specials & Singles", "Classic TV", single_rows, f"{len(tv_single)} one/two-file items", defer_light_rows=True)
        record_rows("tv", single_rows)
    # ---- Documentary
    docs_new = []
    for i in pick_new("documentary"):
        rs, dropped = rows_for([i], 300, source_list="documentary")
        if not rs:
            report["excluded"].setdefault("documentary_no_playable_runtime", []).append(i)
            reject_list("documentary", "no_playable_runtime")
            continue
        t0 = title_of(i)
        if len(CYR.findall(t0)) > len(t0) * 0.3:
            report["excluded"].setdefault("russian_language_title", []).append(i)
            reject_list("documentary", "russian_language_title")
            continue
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
        record_rows("documentary", rs)
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
    report["lists"] = {}
    for name in ("documentary", "cartoons", "tv", "movies"):
        stats = list_stats[name]
        report["lists"][name] = {
            "members": stats["members"],
            "unique_members": stats["unique_members"],
            "duplicate_member_entries": stats["members"] - stats["unique_members"],
            "added": len(stats["added_ids"]),
            "added_rows": stats["added_rows"],
            "skipped_already_in_app": stats["skipped_already_in_app"],
            "skipped_claimed_by_another_list": stats["skipped_claimed"],
            "rejected_reason_counts": stats["rejected"],
        }
    report["deferred_classic_tv_channels"] = sum(
        1 for c in chans if c.get("guideId") == "classic-tv" and c.get("deferLightRows") is True
    )
    json.dump({"schema": "ajn.extraChannelsManifest.v1", "channels": chans}, open(os.path.join(root, a.extra), "w"), separators=(",", ":"))
    for e in docs: e.pop("_ib", None)
    for e in audio: e.pop("_ib", None)
    json.dump(docs, open(os.path.join(root, a.docs), "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump(audio, open(os.path.join(root, a.audio), "w"), indent=1, ensure_ascii=False)
    os.makedirs(os.path.dirname(os.path.join(root, a.report)), exist_ok=True)
    json.dump(report, open(os.path.join(root, a.report), "w"), indent=1)
    print(json.dumps({"lists": report["lists"], "channels": report["channels"], "skipped": {k: len(v) for k, v in report["skipped_in_app"].items()}, "dark": {k: len(v) for k, v in report["dark"].items()},
                      "excluded": {k: (len(v) if isinstance(v, list) else v) for k, v in report["excluded"].items()}, "needs_decision": {k: len(v) for k, v in report["needs_decision"].items()}}, indent=1))
if __name__ == "__main__": main()
