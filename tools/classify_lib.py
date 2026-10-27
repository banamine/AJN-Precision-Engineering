"""Regex-based identification, title standardization and validation for AJN H1 items. Offline, no network."""
import re

# ---------- title standardization ----------
ACRONYMS = {k: k.upper() for k in (
    "nypd lapd fbi cia nsa nasa ufo usa uk bbc nbc cbs abc pbs wkrp cnn mgm dvd vhs hd otr tv "
    "mtv hbo itv cbc ii iii iv").split()}
SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"}
EXT_TAIL = re.compile(r"\.(ia|mp4|m4v|mkv|webm|avi|mpe?g|mp3|ogv|ogg|flac)$", re.I)
SE_PAIR = re.compile(r"\bS\s*0*(\d{1,2})\s*E\s*0*(\d{1,3})\b", re.I)
S_END = re.compile(r"(?<=\s)S\s+0*(\d{1,2})$", re.I)

def _titlecase_lower(s):
    out = []
    for i, w in enumerate(s.split(" ")):
        out.append(w if (i and w in SMALL) or not w else w[0].upper() + w[1:])
    return " ".join(out)

CAMEL = re.compile(r"^[A-Z][a-z]+(?:[A-Z][a-z]+)+\d*$")
LOW_INFO = re.compile(r"^(?:img|dsc|mov|mvi|vid|clip|untitled|new)[\W_]*[a-z]?\d*[a-z]?\d*(?:[\W_]\d+)*$", re.I)

def title_flags(title):
    flat = re.sub(r"\W", "", title)
    flags = []
    if len(flat) <= 4 or flat.isdigit() or LOW_INFO.match(title.strip()) or re.fullmatch(r"tt\d{6,}", flat, re.I): flags.append("title_low_information")
    return flags

ABBREV = {"dr", "mr", "mrs", "ms", "st", "vs", "jr", "sr", "no", "inc", "co", "mt"}
INITIALS = re.compile(r"(?<![A-Za-z])(?:[A-Za-z]\.\s?){2,}")
DOT = "\u2024"        # placeholder so protected dots survive the dot-cleanup below

def clean_title(t):
    """Standardize capitalization/format. Never invents words; only fixes case, spacing, S/E tags, tails, dots, acronyms."""
    s = EXT_TAIL.sub("", t.strip())
    s = s.replace("_", " ")
    s = INITIALS.sub(lambda m: "".join(re.findall(r"[A-Za-z]\.", m.group(0))).replace(".", DOT) + " ", s)   # T. H. E. Cat -> T.H.E. Cat
    s = re.sub(r"\b(" + "|".join(ABBREV) + r")\.", lambda m: m.group(1) + DOT, s, flags=re.I)                # Dr. Mr. kept
    s = SE_PAIR.sub(lambda m: f"S{int(m[1]):02d}E{int(m[2]):02d}", s)
    s = S_END.sub(lambda m: f"S{int(m[1]):02d}", s)
    many_dots = s.count(".") >= 3
    toks = s.split()
    dotted = [x for x in toks if x.endswith(".")]
    if len(toks) >= 4 and len(dotted) >= 2 and len(dotted) >= len(toks) * 0.3:                                   # "The. Avengers. 1965."
        s = " ".join(x.rstrip(".") for x in toks)
    if many_dots: s = s.replace(".", " ")                                                                # scene-release style dots
    s = re.sub(r"(?<=[a-z])\.(?=[A-Z])", " ", s)                                                                # Peter.Gunn -> Peter Gunn
    if s == s.lower() and " " not in s and "-" in s:                                                            # slug-like: boy-and-his-train
        s = s.replace("-", " ")
    s = re.sub(r"\s{2,}", " ", s).strip()
    if s and s == s.lower() and re.search(r"[a-z]", s):                                                         # all-lowercase -> title case
        s = _titlecase_lower(s)
    s = re.sub(r"\b[A-Za-z]+\b", lambda m: ACRONYMS.get(m.group(0).lower(), m.group(0)), s)
    return s.replace(DOT, ".")

def title_from_identifier(ident):
    """Title for items that have none. Keeps existing capitals; splits only pure CamelCase words; no lowercasing."""
    t = re.sub(r"_(\d{6,8})$", "", ident)
    t = re.sub(r"\.ia$", "", t)
    t = re.sub(r"[-_.]+", " ", t).strip()
    words = []
    for w in t.split():
        if CAMEL.match(w):
            w = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", w)
        words.append(w[0].upper() + w[1:] if w.islower() else w)
    out = clean_title(" ".join(words))
    return out

# ---------- identification ----------
ID_RX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]*$")          # valid Archive identifier characters
CONTENT_RX = {
    "episode":   re.compile(r"\bS\s*\d{1,2}\s*E\s*\d{1,3}\b|\bseasons?\b|\bepisodes?\b|\b\d{1,2}x\d{2}\b|\btv series\b|\bcomplete series\b", re.I),
    "movie":     re.compile(r"\((?:19|20)\d{2}\)|\b(?:1080p|720p|480p|580p|bluray|dvdrip|webrip|hdrip|x264)\b", re.I),
    "documentary": re.compile(r"\bdocumentar(?:y|ies)\b|\bchronicles?\b|\bsmithsonian\b|\bscience of\b", re.I),
    "music":     re.compile(r"\b(?:soundtrack|album|songs?|music|mp3|concert|greatest hits|vinyl|ost)\b", re.I),
    "radio":     re.compile(r"\b(?:otr|old[- ]?time radio|radio (?:show|program|theat(?:er|re)|project)|paul harvey)\b", re.I),
    "news-talk": re.compile(r"\b(?:news|talk|press conference|interview|podcast|alex jones|infowars)\b", re.I),
}
CATEGORY_TYPE = {"Classic TV": "episode", "Movies Classics": "movie", "Documentaries": "documentary",
                 "Music": "music", "News/Talk archives": "news-talk", "Old-Time/Radio archives": "radio"}
VIDEO_FMT = {"h.264", "mpeg4", "512kb mpeg4", "quicktime", "webm", "ogg video", "matroska", "mpeg2", "avi", "mpeg"}
AUDIO_FMT = {"mp3", "vbr mp3", "64kbps mp3", "128kbps mp3", "256kbps mp3", "ogg vorbis", "flac", "aac", "wave", "24bit flac"}
VIDEO_EXT = (".mp4", ".m4v", ".webm")
AUDIO_EXT = (".mp3", ".m4a", ".ogg", ".oga", ".flac")

def classify_item(identifier, title, category, mediatype, formats):
    text = re.sub(r"[-_.]+", " ", f"{identifier} {title or ''}")
    signals, conflicts = [], []
    ctype_votes = []
    if category in CATEGORY_TYPE: ctype_votes.append(CATEGORY_TYPE[category]); signals.append("category:" + category)
    for name, rx in CONTENT_RX.items():
        if rx.search(text): signals.append("regex:" + name); ctype_votes.append(name)
    fm = {f.lower() for f in (formats or [])}
    v_fmt, a_fmt = bool(fm & VIDEO_FMT), bool(fm & AUDIO_FMT)
    kinds = set()
    if mediatype == "movies": kinds.add("video"); signals.append("mediatype:movies")
    elif mediatype == "audio": kinds.add("audio"); signals.append("mediatype:audio")
    if v_fmt and not a_fmt: kinds.add("video"); signals.append("format:video")
    elif a_fmt and not v_fmt: kinds.add("audio"); signals.append("format:audio")
    elif v_fmt and a_fmt: signals.append("format:video+audio")
    if len(kinds) > 1: conflicts.append("media_kind_conflict:" + "+".join(sorted(kinds)))
    media_kind = next(iter(kinds)) if len(kinds) == 1 else ("unknown" if not kinds else "conflict")
    # primary content type = category vote if present, else first regex vote, else unclassified
    ctype = ctype_votes[0] if ctype_votes else "unclassified"
    alts = sorted(set(ctype_votes) - {ctype})
    return {"contentType": ctype, "contentTypeAlt": alts, "mediaKind": media_kind,
            "signals": signals, "conflicts": conflicts, "evidence": len(signals),
            "formatsKnown": v_fmt or a_fmt, "mediatypeKnown": mediatype is not None}

def file_kind(name, fmt):
    """Kind of a single file from extension + metadata format, with consistency check. Returns (kind, problem|None)."""
    ext = re.search(r"\.[A-Za-z0-9]+$", name)
    ext = ext.group(0).lower() if ext else ""
    f = (fmt or "").lower()
    if ext in VIDEO_EXT:
        if f in ("matroska", "ogg video", "mpeg2") or f in AUDIO_FMT: return "video", f"container_mismatch:{ext}_labelled_{f}"
        return "video", None
    if ext in AUDIO_EXT:
        if f in VIDEO_FMT: return "audio", f"container_mismatch:{ext}_labelled_{f}"
        return "audio", None
    return "other", None
