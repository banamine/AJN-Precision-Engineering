"""Shared rules for AJN H1 builds. No network access anywhere in this module.

Contract facts below were verified against the uploaded 220-channel / 31,255-row extraChannelsManifest.json.
"""
import hashlib, os, re

THUMB = "__ia_thumb.jpg"
MIN_SECONDS = 30                      # smallest duration present in the existing manifest
ALLOWED_EXT = (".mp4", ".m4v", ".webm")
ROW_KEYS = {"id", "identifier", "file", "title", "bytes", "durationSeconds", "thumb"}
CHANNEL_KEYS = {"guideId", "id", "name", "group", "rows"}

# ---- Rule 1: explicit category skip list (regex, case-insensitive) --------------------------------
EXCLUDED_CATEGORY_RE = re.compile(r"music|news|radio|unsorted", re.I)

def category_excluded(category):
    return bool(EXCLUDED_CATEGORY_RE.search(category or ""))

# ---- IDs --------------------------------------------------------------------------------------------
def row_id(identifier, file):
    """Verified: reproduces all 31,255 existing row ids."""
    return "xc-" + hashlib.md5(f"{identifier}/{file}".encode()).hexdigest()[:14]

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

class IdRegistry:
    """Rule 2: every file gets a unique id. Same (identifier,file) twice = duplicate; same id for a
    different pair (hash truncation collision) = refused, never silently reused."""
    def __init__(self): self.pairs = {}
    def claim(self, identifier, file):
        rid = row_id(identifier, file); pair = (identifier, file)
        if rid in self.pairs:
            return None, ("duplicate_file" if self.pairs[rid] == pair else "id_collision")
        self.pairs[rid] = pair
        return rid, None

# ---- Rule 3: title standardization -----------------------------------------------------------------
ACRONYMS = {"nypd", "tv", "usa", "us", "uk", "fbi", "cia", "dea", "cbs", "nbc", "abc", "bbc", "pbs", "ufo",
            "ufos", "dvd", "vhs", "hd", "sd", "wkrp", "ncis", "csi", "ii", "iii", "iv", "vi", "vii", "viii",
            "ix", "xi", "xii", "mgm", "rca", "aj", "ajn", "ia"}
SMALL = {"a", "an", "the", "of", "and", "in", "on", "at", "to", "for", "vs", "or", "but", "nor", "by", "with"}
RELEASE_TAGS = re.compile(
    r"[\[\(]?\b(?:\d{3,4}p|x26[45]|h\.?26[45]|hevc|blu-?ray|brrip|bdrip|web-?dl|web-?rip|dvdrip|vhsrip|hdtv|"
    r"xvid|divx|aac(?:2\.0)?|ac3|ddp?5\.1|10bit|sdtv)\b[\]\)]?", re.I)

def clean_title(s):
    """Regex clean-up of DISPLAY titles only (never of `file`, which is part of the URL and the row id)."""
    s = (s or "").strip()
    s = re.sub(r"\.(mp4|m4v|webm|mkv|avi|ogv|mpe?g)$", "", s, flags=re.I)
    if " " not in s:
        s = re.sub(r"_(\d{6,8})$", "", s)                     # trailing _202402 style suffix on identifiers
        s = re.sub(r"[-_.]+", " ", s)
    s = RELEASE_TAGS.sub(" ", s)
    s = re.sub(r"[\[\(]\s*[\]\)]", " ", s)                    # empty brackets left behind
    s = re.sub(r"\b[sS](\d{1,2})[eE](\d{1,3})\b", lambda m: f"S{m.group(1)}E{m.group(2)}", s)
    s = re.sub(r"\s+", " ", s).strip(" -_.,")
    letters = [c for c in s if c.isalpha()]
    shouting = len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) >= 0.9

    def fix(m):
        w, i = m.group(0), m.start()
        prev = s[i - 1] if i else ""
        if prev.isdigit():                                    # 1x02, 3rd, S01E02 pieces
            return w
        if w.lower() in ACRONYMS:
            return w.upper()
        first = i == 0 or s[:i].rstrip().endswith((":", "-", "–", "—"))
        if w.islower() or (w.isupper() and (shouting or len(w) > 3)):
            if w.lower() in SMALL and not first:
                return w.lower()
            return w[0].upper() + w[1:].lower()
        return w                                              # mixed case or short caps (ALF, MGM): leave alone
    return re.sub(r"[A-Za-z][A-Za-z']*", fix, s)

# ---- Rule 2: regex identification of what a file / item is ------------------------------------------
EXTRA_RE = re.compile(r"\b(trailer|sample|teaser|featurette|behind[ ._-]the[ ._-]scenes|bloopers?|promo|deleted[ ._-]scenes?)\b", re.I)
EP_STRONG = [re.compile(p, re.I) for p in (r"\bS\d{1,2}[ ._-]?E\d{1,3}\b", r"\b\d{1,2}x\d{2,3}\b",
                                            r"\bseason[ ._-]*\d+.*\bepisode[ ._-]*\d+", r"\bep(?:isode)?[ ._-]?\d{1,3}\b")]
EP_WEAK = re.compile(r"^\s*\d{1,3}\s*[-.)]\s*\S")
YEAR = re.compile(r"(?<!\d)(19[2-9]\d|20[0-2]\d)(?!\d)")

def classify_file(name, seconds=None):
    """-> {'type': episode|movie|extra|unknown, 'confidence': strong|weak|none, season, episode, year}"""
    stem = os.path.splitext(os.path.basename(name))[0]
    out = {"type": "unknown", "confidence": "none", "season": None, "episode": None, "year": None}
    ym = YEAR.search(stem)
    if ym: out["year"] = int(ym.group(1))
    if EXTRA_RE.search(stem): return dict(out, type="extra", confidence="strong")
    for rx in EP_STRONG:
        m = rx.search(stem)
        if m:
            nums = [int(n) for n in re.findall(r"\d+", m.group(0))]
            out.update(type="episode", confidence="strong")
            if len(nums) >= 2: out.update(season=nums[0], episode=nums[1])
            elif nums: out.update(episode=nums[0])
            return out
    if EP_WEAK.match(stem): return dict(out, type="episode", confidence="weak", episode=int(re.match(r"\s*(\d+)", stem).group(1)))
    if ym and (seconds or 0) >= 3000: return dict(out, type="movie", confidence="strong")
    if (seconds or 0) >= 4800: return dict(out, type="movie", confidence="weak")
    return out

# ---- Rule 6: file-type profiles ---------------------------------------------------------------------
def profile_key(name, fmt, source):
    return f"{os.path.splitext(name)[1].lower()}|{(fmt or '').lower()}|{source or ''}"

# ---- Rule 4: validation -------------------------------------------------------------------------------
def parse_length(v):
    """IA 'length' is seconds (str/float) or [H:]MM:SS. Returns int seconds or None."""
    if v is None: return None
    s = str(v).strip()
    try:
        if ":" in s:
            sec = 0.0
            for p in s.split(":"): sec = sec * 60 + float(p)
            return int(round(sec))
        return int(round(float(s)))
    except ValueError:
        return None

MISMATCH_FORMATS = ("matroska", "webm", "ogg video", "mpeg2", "avi")   # container labels that contradict an .mp4/.m4v name

def validate_file_entry(f):
    """Check ONE Archive files[] entry. Returns (ok, reason, parsed). Reasons that mean 'unsure' start with 'defer:'."""
    name = f.get("name", "") or ""
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT: return False, "ignored_non_video", None
    if re.search(r"[\x00-\x1f]|(^|/)\.\.(/|$)", name): return False, "defer:unsafe_file_name", None
    fmt = (f.get("format") or "").lower()
    if ext in (".mp4", ".m4v") and fmt in MISMATCH_FORMATS: return False, f"defer:container_mismatch_named_{ext[1:]}_format_{fmt.replace(' ', '_')}", None
    if ext == ".webm" and fmt and "webm" not in fmt: return False, f"defer:container_mismatch_named_webm_format_{fmt.replace(' ', '_')}", None
    sec = parse_length(f.get("length"))
    if sec is None: return False, "defer:duration_unknown", None
    if sec < MIN_SECONDS: return False, "under_30_seconds", None
    try: size = int(f.get("size"))
    except (TypeError, ValueError): return False, "defer:size_unknown", None
    if size <= 0: return False, "defer:size_unknown", None
    return True, None, {"name": name, "bytes": size, "seconds": sec, "format": f.get("format"), "source": f.get("source")}

def make_row(identifier, file, title, nbytes, seconds, rid=None):
    assert isinstance(nbytes, int) and nbytes > 0, "bytes must be int > 0"
    assert isinstance(seconds, int) and seconds >= MIN_SECONDS, "durationSeconds must be int >= 30"
    assert title.strip(), "title must not be empty"
    return {"id": rid or row_id(identifier, file), "identifier": identifier, "file": file,
            "title": title, "bytes": nbytes, "durationSeconds": seconds, "thumb": THUMB}

def validate(manifest):
    """Structural checks mirroring the existing contract. Returns list of problems."""
    bad = []
    if manifest.get("schema") != "ajn.extraChannelsManifest.v1": bad.append("schema")
    seen_ch = set()
    for c in manifest["channels"]:
        if set(c) != CHANNEL_KEYS: bad.append(f"channel keys {c.get('id')}")
        if c["id"] in seen_ch: bad.append(f"duplicate channel id {c['id']}")
        seen_ch.add(c["id"])
        ids = set()
        for r in c["rows"]:
            if set(r) != ROW_KEYS: bad.append(f"row keys {r.get('id')}")
            if r["id"] != row_id(r["identifier"], r["file"]): bad.append(f"row id formula {r['id']}")
            if r["id"] in ids: bad.append(f"duplicate row id in channel {c['id']}")
            ids.add(r["id"])
            if not (isinstance(r["durationSeconds"], int) and r["durationSeconds"] >= MIN_SECONDS): bad.append(f"duration {r['id']}")
            if not (isinstance(r["bytes"], int) and r["bytes"] > 0): bad.append(f"bytes {r['id']}")
            if not str(r["title"]).strip(): bad.append(f"empty title {r['id']}")
    return bad
