#!/usr/bin/env python3
"""
Archive.org read-only index probe (tools/archive-probe/archive_probe.py)
=======================================================================

Builds `library_index.json` and `gap_report.json` from Archive.org JSON APIs.
Nothing here writes to Archive.org or to any app data: HTTP GET only, and the
only files written are the two reports in --output-dir.

Sources (all discovered through backend JSON endpoints, never HTML scraping):
  * @infobattalion: custom lists, favorites (collection fav-<name>), uploads
  * @sammo770: uploads
  * optional uploader cross-check via secret env ARCHIVE_UPLOADER_EMAILS
  * or a targeted run: --items id1,id2,... (skips account discovery)

Admission rule (strict, never guessed):
  a file is admitted only with a real `length` from Archive metadata, a
  non-restricted item and a non-private file. Everything else goes to the gap
  report with explicit reasons. Zip/7z members have no duration in metadata, so
  they are listed as gaps ("zip_member_duration_unverified") for a later ffprobe
  step; they are never admitted.

Privacy: the uploader email(s) are used only to search and to compare with
metadata.uploader. They are never written to reports, logs or exceptions
(see redact()). Reports only carry a boolean `uploader_confirmed`.

Exit codes: 0 ok; 2 @infobattalion returned no lists or no uploads; 3 more than
20% of /metadata requests failed; 4 nothing admitted. Reports are written first.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import logging
import os
import re
import sys
import time
import urllib.parse
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

try:  # requests is only needed for live runs; the self-test is fully offline
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

BASE_URL = "https://archive.org"
USER_LISTS_SERVICE_URL = f"{BASE_URL}/services/users/@{{username}}/lists"
PAGE_PRODUCTION_API_URL = f"{BASE_URL}/services/search/beta/page_production/"
SCRAPE_API_URL = f"{BASE_URL}/services/search/v1/scrape"
ADVANCED_SEARCH_URL = f"{BASE_URL}/advancedsearch.php"
METADATA_API_URL = f"{BASE_URL}/metadata/{{identifier}}"
DOWNLOAD_URL = f"{BASE_URL}/download/{{identifier}}/{{path}}"

DEFAULT_USER_AGENT = "AJN-ArchiveReadOnlyIndexProbe/2.0 (read-only catalog check)"
SCHEMA_VERSION = "2.0.0"

EXPECTED_INFOBATTALION_LISTS = ["Tv Classics", "Documentary", "Music", "Cartoons", "Movies Classics"]

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".ogv", ".mpeg", ".mpg", ".m4v"}
AUDIO_EXTENSIONS = {".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".wma"}
CONTAINER_EXTENSIONS = (".zip", ".7z")

VIDEO_FORMAT_KEYWORDS = {"h.264", "mpeg4", "matroska", "ogg video", "webm", "quicktime", "cinepak",
                         "divx", "windows media", "mpeg2", "mp4"}
AUDIO_FORMAT_KEYWORDS = {"vbr mp3", "mp3", "flac", "ogg vorbis", "wave", "wav", "aac", "m4a",
                         "24bit flac", "64kbps mp3", "128kbps mp3"}

IGNORED_FILE_SUFFIXES = ("_meta.xml", "_files.xml", "_reviews.xml", "_meta.sqlite", "_archive.torrent",
                         "__ia_thumb.jpg", ".gif", ".jpg", ".jpeg", ".png", ".txt", ".pdf", ".srt",
                         ".vtt", ".afpk", ".pkf", ".xml", ".torrent", ".json", ".sqlite")

# fix E6: no leading space, so this really matches
RESTRICTED_COLLECTIONS = {"inlibrary", "printdisabled", "stream_only", "lendinglibrary"}

# stripped from the episode key so renditions of one episode group together
RENDITION_SUFFIXES = (".ia", "_512kb", "_256kb", "_64kb", "_h264")
LOW_BITRATE_MARKERS = ("512kb", "256kb", "64kb")

logger = logging.getLogger("archive_probe")


# ---------------------------------------------------------------------------
# Privacy: uploader emails are secret
# ---------------------------------------------------------------------------

_UPLOADER_EMAILS: Set[str] = set()


def load_uploader_emails(env: Optional[Dict[str, str]] = None) -> Set[str]:
    raw = (env if env is not None else os.environ).get("ARCHIVE_UPLOADER_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def set_uploader_emails(emails: Set[str]) -> None:
    global _UPLOADER_EMAILS
    _UPLOADER_EMAILS = set(emails)


def redact(text: Any) -> str:
    """Replace every configured email (plain and URL-encoded) with [redacted]."""
    out = str(text)
    for email in _UPLOADER_EMAILS:
        for variant in {email, urllib.parse.quote(email), urllib.parse.quote(email, safe=""),
                        urllib.parse.quote_plus(email)}:
            out = re.sub(re.escape(variant), "[redacted]", out, flags=re.IGNORECASE)
    return out


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(record.getMessage())
            record.args = ()
        except Exception:
            record.msg = "[log message withheld: redaction failed]"
            record.args = ()
        return True


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                        datefmt="%Y-%m-%dT%H:%M:%SZ")
    if not any(isinstance(f, _RedactFilter) for f in logger.filters):
        logger.addFilter(_RedactFilter())


# ---------------------------------------------------------------------------
# Endpoint ledger (fix E5): every call is recorded, failures are never silent
# ---------------------------------------------------------------------------

endpoint_log: List[Dict[str, Any]] = []


def log_endpoint(endpoint: str, status: Optional[int], items: Optional[int], error: Optional[str] = None) -> None:
    entry = {"endpoint": redact(endpoint), "http_status": status, "items_returned": items,
             "error": redact(error) if error else None}
    endpoint_log.append(entry)
    if error or (status is not None and status != 200):
        logger.warning("endpoint %s -> status=%s error=%s", entry["endpoint"], status, entry["error"])


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class AdmittedMediaItem:
    identifier: str
    file_name: str
    duration_seconds: float
    duration_raw: str
    media_type: str  # per FILE (fix E7)
    item_mediatype: Optional[str]
    genre: str
    show_name: str
    file_title: Optional[str]
    season: Optional[int]
    episode: Optional[int]
    file_format: Optional[str]
    file_source: Optional[str]
    size_bytes: Optional[int]
    sources: List[Dict[str, Any]]
    uploader_confirmed: bool
    playable: bool
    status: str
    item_url: str
    download_url: str
    metadata_url: str
    playable_http_status: Optional[int] = None


@dataclass
class GapReportEntry:
    identifier: str
    file_name: Optional[str]
    duration_seconds: Optional[float]
    duration_raw: Optional[str]
    media_type: Optional[str]
    item_mediatype: Optional[str]
    genre: Optional[str]
    show_name: Optional[str]
    file_title: Optional[str]
    sources: List[Dict[str, Any]]
    uploader_confirmed: bool
    playable: bool
    status: str  # restricted | unplayable | incomplete_metadata
    gap_reasons: List[str] = field(default_factory=list)
    item_url: str = ""
    metadata_url: str = ""


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def parse_strict_duration(raw_length: Any) -> Optional[float]:
    """Seconds from a file `length` ("1742.54", "01:24:15", "24:15"); None if missing/invalid. Never estimates."""
    if raw_length is None:
        return None
    val = str(raw_length).strip()
    if not val:
        return None
    try:
        seconds = float(val)
        return round(seconds, 3) if seconds > 0 else None
    except ValueError:
        pass
    if ":" in val:
        parts = val.split(":")
        if len(parts) in (2, 3):
            try:
                if len(parts) == 3:
                    total = int(parts[0]) * 3600.0 + int(parts[1]) * 60.0 + float(parts[2])
                else:
                    total = int(parts[0]) * 60.0 + float(parts[1])
                if total > 0 and all(float(p) >= 0 for p in parts):
                    return round(total, 3)
            except ValueError:
                return None
    return None


def normalize_list_field(raw_val: Any) -> List[str]:
    if raw_val is None:
        return []
    if isinstance(raw_val, list):
        return [str(x).strip() for x in raw_val if str(x).strip()]
    if isinstance(raw_val, str):
        if ";" in raw_val:
            return [p.strip() for p in raw_val.split(";") if p.strip()]
        return [raw_val.strip()] if raw_val.strip() else []
    return [str(raw_val).strip()]


_SE_PATTERNS = (re.compile(r"[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})"), re.compile(r"(?<!\d)(\d{1,2})x(\d{2,3})(?!\d)"))


def parse_season_episode(*texts: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
    """S01E02, 'S02 E02' and 1x02 only. Never guesses: no pattern -> (None, None)."""
    for text in texts:
        if not text:
            continue
        base = text.replace("\\", "/").rsplit("/", 1)[-1]
        for pat in _SE_PATTERNS:
            m = pat.search(base)
            if m:
                return int(m.group(1)), int(m.group(2))
    return None, None


def episode_key(file_name: str) -> str:
    """Full path (folders kept) lower-cased, extension and rendition suffixes removed."""
    p = PurePosixPath(file_name.replace("\\", "/").lower())
    key = str(p.with_suffix("")) if p.suffix else str(p)
    changed = True
    while changed:
        changed = False
        for suf in RENDITION_SUFFIXES:
            if key.endswith(suf):
                key = key[: -len(suf)]
                changed = True
    return key


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def build_http_session(user_agent: str = DEFAULT_USER_AGENT) -> "requests.Session":
    if requests is None:
        raise RuntimeError("the 'requests' package is required for live runs: pip install requests")
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent, "Accept": "application/json, text/plain, */*"})
    retry = Retry(total=4, connect=3, read=3, status=4, backoff_factor=1.5,
                  status_forcelist=[429, 500, 502, 503, 504], allowed_methods=frozenset(["GET"]),
                  raise_on_status=False)
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def get_json(session: Any, url: str, params: Optional[Dict[str, str]], label: str,
             timeout: int = 25) -> Tuple[Optional[int], Optional[Any]]:
    """GET + parse JSON, ledger every call. `label` is what gets recorded (never the raw query)."""
    try:
        resp = session.get(url, params=params, timeout=timeout)
    except Exception as exc:
        log_endpoint(label, None, None, f"{type(exc).__name__}: {exc}")
        return None, None
    if resp.status_code != 200:
        log_endpoint(label, resp.status_code, None)
        return resp.status_code, None
    try:
        data = resp.json()
    except ValueError:
        log_endpoint(label, 200, None, "response_not_json")
        return 200, None
    return 200, data


# ---------------------------------------------------------------------------
# Discovery (no HTML, no JS rendering needed)
# ---------------------------------------------------------------------------


def source_dict(source_type: str, account: str, list_name: Optional[str] = None,
                list_id: Optional[str] = None, via: Optional[str] = None) -> Dict[str, Any]:
    return {"source": source_type, "account": account, "list_name": list_name, "list_id": list_id, "via": via}


class ArchiveDiscoveryClient:
    def __init__(self, session: Any, max_list_probe_id: int = 50) -> None:
        self.session = session
        self.max_list_probe_id = max_list_probe_id

    # -- lists ---------------------------------------------------------------
    def fetch_user_lists(self, username: str) -> Tuple[Dict[str, List[Dict[str, Any]]], List[Dict[str, Any]]]:
        """Returns ({identifier: [source dicts]}, list_summaries)."""
        user = username.lstrip("@")
        refs: Dict[str, List[Dict[str, Any]]] = {}
        summaries: List[Dict[str, Any]] = []
        seen: Set[str] = set()
        index_url = USER_LISTS_SERVICE_URL.format(username=user)

        candidates: List[Dict[str, Any]] = []
        status, payload = get_json(self.session, index_url, None, f"/services/users/@{user}/lists")
        if payload is not None:
            val = payload.get("value", payload) if isinstance(payload, dict) else payload
            if isinstance(val, list):
                candidates.extend(x for x in val if isinstance(x, dict))
            elif isinstance(val, dict):
                for key in ("lists", "items", "members", "results"):
                    if isinstance(val.get(key), list):
                        candidates.extend(x for x in val[key] if isinstance(x, dict))
                        break
        if not candidates:
            candidates.extend(self._lists_via_page_production(user))

        for entry in candidates:
            lid = str(entry.get("list_id") or entry.get("id") or entry.get("identifier") or "").strip()
            name = entry.get("list_name") or entry.get("title") or entry.get("name") or f"List {lid}"
            if lid and lid not in seen:
                seen.add(lid)
                self._take_list(user, lid, name, refs, summaries)

        misses = 0
        for num in range(1, self.max_list_probe_id + 1):
            lid = str(num)
            if lid in seen:
                misses = 0
                continue
            ok = self._take_list(user, lid, None, refs, summaries)
            if ok:
                seen.add(lid)
                misses = 0
            else:
                misses += 1
                if misses >= 10:
                    break
        logger.info("Discovered %d custom lists for @%s.", len(summaries), user)
        return refs, summaries

    def _lists_via_page_production(self, user: str) -> List[Dict[str, Any]]:
        found: List[Dict[str, Any]] = []
        for page in range(1, 6):
            params = {"user_query": "", "page_type": "account_details", "page_target": f"@{user}",
                      "page_elements": '["lists"]', "hits_per_page": "50", "page": str(page)}
            status, data = get_json(self.session, PAGE_PRODUCTION_API_URL, params,
                                    "/services/search/beta/page_production/ [lists]")
            if not isinstance(data, dict):
                break
            elements = data.get("response", {}).get("body", {}).get("page_elements", {}).get("lists", {})
            hits = elements.get("hits", {}).get("hits", []) if isinstance(elements, dict) else []
            if not hits:
                break
            found.extend(h.get("fields", h) for h in hits if isinstance(h, dict))
            if len(hits) < 50:
                break
        return found

    def _take_list(self, user: str, lid: str, fallback: Optional[str], refs: Dict[str, List[Dict[str, Any]]],
                   summaries: List[Dict[str, Any]]) -> bool:
        url = f"{USER_LISTS_SERVICE_URL.format(username=user)}/{lid}"
        status, payload = get_json(self.session, url, None, f"/services/users/@{user}/lists/{lid}")
        if not isinstance(payload, dict) or payload.get("success") is False:
            return False
        value = payload.get("value", payload)
        if not isinstance(value, dict):
            return False
        name = value.get("list_name") or value.get("title") or value.get("name") or fallback
        members = value.get("members", [])
        members = members if isinstance(members, list) else []
        if not name and not members:
            return False
        name = str(name or f"List {lid}").strip()
        count = 0
        for m in members:
            ident = str((m.get("identifier") or m.get("id") or "") if isinstance(m, dict) else m).strip()
            if ident:
                count += 1
                refs.setdefault(ident, []).append(source_dict("list", f"@{user}", name, lid))
        summaries.append({"list_id": lid, "list_name": name, "item_count": count,
                          "endpoint": f"/services/users/@{user}/lists/{lid}"})
        return True

    # -- favorites -----------------------------------------------------------
    def fetch_user_favorites(self, username: str) -> Dict[str, List[Dict[str, Any]]]:
        user = username.lstrip("@")
        ids = self._scrape(f"collection:fav-{user}", f"scrape collection:fav-{user}")
        if not ids:
            ids = self._tab_identifiers(user, "favorites")
        logger.info("Found %d favorites for @%s.", len(ids), user)
        return {i: [source_dict("favorite", f"@{user}", "Favorites")] for i in ids}

    # -- uploads -------------------------------------------------------------
    def fetch_user_uploads(self, username: str) -> Dict[str, List[Dict[str, Any]]]:
        user = username.lstrip("@")
        ids = self._tab_identifiers(user, "uploads")
        logger.info("Found %d uploads for @%s.", len(ids), user)
        return {i: [source_dict("upload", f"@{user}")] for i in ids}

    def fetch_uploads_by_uploader_email(self, emails: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
        """E8: search by uploader email. The query is never logged or recorded (label is generic)."""
        out: Dict[str, List[Dict[str, Any]]] = {}
        for email in sorted(emails):
            ids = self._scrape(f'uploader:"{email}"', "scrape [uploader query]")
            for i in ids:
                out.setdefault(i, []).append(source_dict("upload", "(uploader email match)", via="uploader_query"))
        logger.info("Uploader cross-check found %d items.", len(out))
        return out

    # -- low level -----------------------------------------------------------
    def _scrape(self, query: str, label: str) -> List[str]:
        ids: List[str] = []
        seen: Set[str] = set()
        cursor: Optional[str] = None
        while True:
            params = {"q": query, "fields": "identifier", "count": "1000"}
            if cursor:
                params["cursor"] = cursor
            status, data = get_json(self.session, SCRAPE_API_URL, params, label)
            if not isinstance(data, dict):
                break
            items = data.get("items", [])
            for it in items:
                ident = str(it.get("identifier", "")).strip()
                if ident and ident not in seen:
                    seen.add(ident)
                    ids.append(ident)
            cursor = data.get("cursor")
            log_endpoint(label + " (page)", 200, len(items))
            if not cursor or not items:
                break
        return ids

    def _tab_identifiers(self, user: str, tab: str) -> List[str]:
        ids: List[str] = []
        seen: Set[str] = set()
        for page in range(1, 101):
            params = {"user_query": "", "page_type": "account_details", "page_target": f"@{user}",
                      "page_elements": f'["{tab}"]', "hits_per_page": "100", "page": str(page)}
            status, data = get_json(self.session, PAGE_PRODUCTION_API_URL, params,
                                    f"/services/search/beta/page_production/ [{tab}] @{user} p{page}")
            if not isinstance(data, dict):
                break
            container = data.get("response", {}).get("body", {}).get("page_elements", {}).get(tab, {})
            hc = container.get("hits", {}) if isinstance(container, dict) else {}
            hits = hc.get("hits", []) if isinstance(hc, dict) else []
            if not hits:
                break
            for h in hits:
                fields = h.get("fields", h) if isinstance(h, dict) else {}
                ident = str(fields.get("identifier", "")).strip()
                if ident and ident not in seen:
                    seen.add(ident)
                    ids.append(ident)
            total = int(hc.get("total", 0) or 0)
            if len(ids) >= total or len(hits) < 100:
                break
        return ids


# ---------------------------------------------------------------------------
# Item inspection and admission
# ---------------------------------------------------------------------------

ZipLister = Callable[[str, str], Tuple[List[str], Optional[str]]]


def classify_file_media_type(file_obj: Dict[str, Any], item_mediatype: str) -> Optional[str]:
    name = str(file_obj.get("name", "")).strip()
    if not name:
        return None
    lower = name.lower()
    if lower.endswith(IGNORED_FILE_SUFFIXES) or ".thumbs/" in lower:
        return None
    if lower.endswith(CONTAINER_EXTENSIONS):
        return None
    ext = PurePosixPath(lower).suffix
    fmt = str(file_obj.get("format", "")).strip().lower()
    if ext in VIDEO_EXTENSIONS or any(k in fmt for k in VIDEO_FORMAT_KEYWORDS):
        return "video"
    if ext in AUDIO_EXTENSIONS or any(k in fmt for k in AUDIO_FORMAT_KEYWORDS):
        return "audio"
    return None


def _file_rank(f: Dict[str, Any], ftype: str) -> Tuple[int, int, int, int]:
    """Higher is better: not private, has real length, not low-bitrate, container preference (E2/E3)."""
    name = str(f.get("name", "")).lower()
    fmt = str(f.get("format", "")).lower()
    ext = PurePosixPath(name).suffix
    private = str(f.get("private", "")).lower() in ("true", "1", "yes")
    low = any(m in name or m in fmt for m in LOW_BITRATE_MARKERS)
    if "h.264" in fmt or (ext == ".mp4" and str(f.get("source", "")).lower() == "derivative"):
        pref = 5
    elif ext == ".mp4":
        pref = 4
    elif ftype == "audio" and ext in (".mp3", ".m4a", ".flac"):
        pref = 4
    elif ext in (".mkv", ".webm", ".ogv", ".ogg", ".wav"):
        pref = 3
    elif ext in (".avi", ".mpg", ".mpeg", ".mov", ".m4v"):
        pref = 2
    else:
        pref = 1
    return (0 if private else 1, 1 if parse_strict_duration(f.get("length")) is not None else 0,
            0 if low else 1, pref)


def _to_int(v: Any) -> Optional[int]:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return None


def inspect_item(identifier: str, payload: Optional[Dict[str, Any]], sources: List[Dict[str, Any]],
                 zip_lister: Optional[ZipLister] = None) -> Tuple[List[AdmittedMediaItem], List[GapReportEntry]]:
    item_url = f"{BASE_URL}/details/{urllib.parse.quote(identifier)}"
    metadata_url = METADATA_API_URL.format(identifier=urllib.parse.quote(identifier))
    list_names = []
    for s in sources:
        if s.get("source") == "list" and s.get("list_name") and s["list_name"] not in list_names:
            list_names.append(s["list_name"])

    def whole_item_gap(reason: str, status: str = "unplayable", genre: Optional[str] = None,
                       show: Optional[str] = None, mt: Optional[str] = None) -> List[GapReportEntry]:
        return [GapReportEntry(identifier=identifier, file_name=None, duration_seconds=None, duration_raw=None,
                               media_type=None, item_mediatype=mt, genre=genre or ", ".join(list_names) or None,
                               show_name=show, file_title=None, sources=sources, uploader_confirmed=False,
                               playable=False, status=status, gap_reasons=[reason], item_url=item_url,
                               metadata_url=metadata_url)]

    if not payload or not isinstance(payload, dict):
        return [], whole_item_gap("metadata_fetch_failed_or_empty_record")
    if payload.get("error"):
        return [], whole_item_gap(f"metadata_api_error: {redact(payload.get('error'))}")

    metadata = payload.get("metadata", {})
    metadata = metadata if isinstance(metadata, dict) else {}
    files = payload.get("files", [])
    files = files if isinstance(files, list) else []

    raw_mt = str(metadata.get("mediatype", "")).strip().lower()
    item_mt = "video" if raw_mt in ("movies", "video", "movingimage") else (
        "audio" if raw_mt in ("audio", "etree", "sound") else None)
    titles = normalize_list_field(metadata.get("title") or metadata.get("programme") or metadata.get("series"))
    show_name = titles[0] if titles else identifier
    subjects = normalize_list_field(metadata.get("genre") or metadata.get("subject"))
    genre_parts = list_names + [s for s in subjects[:3] if s.lower() not in {n.lower() for n in list_names}]
    genre = ", ".join(genre_parts) if genre_parts else "Uncategorized"

    uploader = str(metadata.get("uploader", "")).strip().lower()
    uploader_confirmed = bool(uploader) and uploader in _UPLOADER_EMAILS
    del uploader  # never stored or logged

    item_reasons: List[str] = []
    if payload.get("is_dark") is True:
        item_reasons.append("item_is_darked")
    if str(metadata.get("access-restricted-item", "")).strip().lower() in ("true", "1", "yes"):
        item_reasons.append("access_restricted_item_true")
    cols = {c.lower() for c in normalize_list_field(metadata.get("collection"))}
    overlap = sorted(cols & RESTRICTED_COLLECTIONS)
    if overlap:
        item_reasons.append(f"restricted_collection:{','.join(overlap)}")

    def gap(file_name: Optional[str], reasons: List[str], status: str, mt: Optional[str] = None,
            dur: Optional[float] = None, raw: Optional[str] = None, title: Optional[str] = None,
            playable: bool = False) -> GapReportEntry:
        return GapReportEntry(identifier=identifier, file_name=file_name, duration_seconds=dur, duration_raw=raw,
                              media_type=mt, item_mediatype=item_mt, genre=genre, show_name=show_name,
                              file_title=title, sources=sources, uploader_confirmed=uploader_confirmed,
                              playable=playable, status=status, gap_reasons=reasons, item_url=item_url,
                              metadata_url=metadata_url)

    admitted: List[AdmittedMediaItem] = []
    gaps: List[GapReportEntry] = []

    # E1: zip / 7z containers: members listed, never admitted (no duration available)
    zip_gaps = 0
    for f in files:
        name = str(f.get("name", "")) if isinstance(f, dict) else ""
        if name.lower().endswith(CONTAINER_EXTENSIONS):
            if zip_lister is None:
                gaps.append(gap(name, item_reasons + ["zip_listing_not_attempted"], "incomplete_metadata"))
                zip_gaps += 1
                continue
            members, err = zip_lister(identifier, name)
            if err:
                gaps.append(gap(name, item_reasons + [f"zip_listing_failed:{err}"], "incomplete_metadata"))
                zip_gaps += 1
                continue
            for member in members:
                ext = PurePosixPath(member.lower()).suffix
                mt = "video" if ext in VIDEO_EXTENSIONS else "audio"
                gaps.append(gap(f"{name}/{member}", item_reasons + ["zip_member_duration_unverified"],
                                "restricted" if item_reasons else "incomplete_metadata", mt))
                zip_gaps += 1

    media: List[Tuple[Dict[str, Any], str]] = []
    for f in files:
        if isinstance(f, dict):
            t = classify_file_media_type(f, raw_mt)
            if t:
                media.append((f, t))

    if not media:
        if not zip_gaps:
            gaps.extend(whole_item_gap(
                "; ".join(item_reasons + ["no_playable_audio_or_video_files_present"]),
                "restricted" if item_reasons else "unplayable", genre, show_name, item_mt))
        return admitted, gaps

    groups: Dict[str, List[Tuple[Dict[str, Any], str]]] = {}
    for f, t in media:
        groups.setdefault(episode_key(str(f.get("name", ""))), []).append((f, t))

    for key, cands in groups.items():
        ranked = sorted(cands, key=lambda ft: _file_rank(ft[0], ft[1]), reverse=True)
        best, ftype = ranked[0]
        file_name = str(best.get("name", "")).strip()
        raw_len = best.get("length")
        dur = parse_strict_duration(raw_len)
        if dur is None:
            for alt, _ in ranked[1:]:
                alt_dur = parse_strict_duration(alt.get("length"))
                if alt_dur is not None:
                    dur, raw_len = alt_dur, alt.get("length")
                    break
        reasons = list(item_reasons)
        if str(best.get("private", "")).strip().lower() in ("true", "1", "yes"):
            reasons.append("file_marked_private")
        if dur is None:
            reasons.append("missing_or_unparseable_real_duration")
        restricted = any(r.startswith(("item_is_darked", "access_restricted", "restricted_collection",
                                       "file_marked_private")) for r in reasons)
        title = str(best.get("title")).strip() if best.get("title") else None
        if not reasons and dur is not None and file_name:
            season, episode = parse_season_episode(title, file_name)
            admitted.append(AdmittedMediaItem(
                identifier=identifier, file_name=file_name, duration_seconds=dur, duration_raw=str(raw_len),
                media_type=ftype, item_mediatype=item_mt, genre=genre, show_name=show_name, file_title=title,
                season=season, episode=episode, file_format=best.get("format"),
                file_source=best.get("source"), size_bytes=_to_int(best.get("size")), sources=sources,
                uploader_confirmed=uploader_confirmed, playable=True, status="playable", item_url=item_url,
                download_url=DOWNLOAD_URL.format(identifier=urllib.parse.quote(identifier),
                                                 path=urllib.parse.quote(file_name)),
                metadata_url=metadata_url))
        else:
            gaps.append(gap(file_name or None, reasons, "restricted" if restricted else "incomplete_metadata",
                            ftype, dur, str(raw_len) if raw_len is not None else None, title,
                            playable=(not restricted) and bool(file_name)))
    return admitted, gaps


def make_zip_lister(session: Any) -> ZipLister:
    link_re = re.compile(r'href="([^"]+)"', re.IGNORECASE)

    def lister(identifier: str, zipname: str) -> Tuple[List[str], Optional[str]]:
        url = f"{BASE_URL}/download/{urllib.parse.quote(identifier)}/{urllib.parse.quote(zipname)}/"
        label = f"/download/{identifier}/{zipname}/ [listing]"
        try:
            resp = session.get(url, timeout=30)
        except Exception as exc:
            log_endpoint(label, None, None, f"{type(exc).__name__}: {exc}")
            return [], "request_error"
        if resp.status_code != 200:
            log_endpoint(label, resp.status_code, None)
            return [], f"HTTP {resp.status_code}"
        members: List[str] = []
        for href in link_re.findall(resp.text):
            path = urllib.parse.unquote(href.split("?")[0].split("#")[0])
            ext = PurePosixPath(path.lower()).suffix
            if ext in VIDEO_EXTENSIONS or ext in AUDIO_EXTENSIONS:
                member = path.rsplit(zipname + "/", 1)[-1].lstrip("/")
                if member and member not in members:
                    members.append(member)
        log_endpoint(label, 200, len(members))
        return members, None

    return lister


def fetch_item_metadata(session: Any, identifier: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    url = METADATA_API_URL.format(identifier=urllib.parse.quote(identifier))
    try:
        resp = session.get(url, timeout=60)
        if resp.status_code != 200:
            return identifier, {"error": f"HTTP {resp.status_code}"}
        data = resp.json()
        return identifier, (data if isinstance(data, dict) and data else None)
    except Exception as exc:
        return identifier, {"error": f"{type(exc).__name__}: {exc}"}


def verify_playable(session: Any, item: AdmittedMediaItem) -> Optional[str]:
    """E10: one 1-byte ranged GET. Returns a gap reason, or None if playable. Sets item.playable_http_status."""
    try:
        resp = session.get(item.download_url, headers={"Range": "bytes=0-0"}, timeout=20, stream=True)
        item.playable_http_status = resp.status_code
        resp.close()
    except Exception as exc:
        return f"download_request_error:{type(exc).__name__}"
    if item.playable_http_status in (200, 206):
        return None
    if item.playable_http_status in (401, 403):
        return "download_403_restricted"
    return f"download_http_{item.playable_http_status}"


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def compute_exit_code(lists_n: int, uploads_n: int, meta_total: int, meta_errors: int, admitted_n: int,
                      targeted: bool = False) -> int:
    if not targeted and (lists_n == 0 or uploads_n == 0):
        return 2
    if meta_total and meta_errors / meta_total > 0.20:
        return 3
    if admitted_n == 0:
        return 4
    return 0


def merge_sources(*maps: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for m in maps:
        for ident, srcs in m.items():
            bucket = out.setdefault(ident, [])
            for s in srcs:
                if s not in bucket:
                    bucket.append(s)
    return out


def write_reports(output_dir: Path, index: Dict[str, Any], gap_report: Dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "library_index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / "gap_report.json").write_text(
        json.dumps(gap_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_reports(admitted: List[AdmittedMediaItem], gaps: List[GapReportEntry], *, accounts: List[str],
                  list_summaries: List[Dict[str, Any]], uploader_check: str, meta_stats: Dict[str, Any],
                  unique_ids: int, elapsed: float, targeted: List[str]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    names = {str(s.get("list_name", "")).strip().lower() for s in list_summaries}
    missing_lists = [e for e in EXPECTED_INFOBATTALION_LISTS if e.lower() not in names]
    index = {
        "schema_version": SCHEMA_VERSION, "probe_mode": "read_only", "generated_at": now,
        "execution_time_seconds": elapsed, "accounts_probed": accounts, "targeted_items": targeted,
        "uploader_cross_check": uploader_check,
        "summary": {"unique_identifiers_inspected": unique_ids, "admitted_media_count": len(admitted),
                    "rejected_gap_count": len(gaps), "infobattalion_lists_discovered": len(list_summaries),
                    "admission_rule": "strict_real_duration_and_playable_flag_required"},
        "metadata_stats": meta_stats, "endpoint_log": endpoint_log,
        "discovered_lists": list_summaries, "items": [asdict(a) for a in admitted]}
    gap_report = {
        "schema_version": SCHEMA_VERSION, "probe_mode": "read_only", "generated_at": now,
        "summary": {"total_gap_entries": len(gaps), "missing_expected_lists": missing_lists,
                    "gap_breakdown_by_status": {s: sum(1 for g in gaps if g.status == s)
                                                for s in ("restricted", "incomplete_metadata", "unplayable")}},
        "gaps": [asdict(g) for g in gaps]}
    return index, gap_report


def run_probe(output_dir: Path, infobattalion_user: str = "infobattalion", sammo_user: str = "sammo770",
              max_workers: int = 8, max_list_probe_id: int = 50, do_verify_playable: bool = False,
              only_items: Optional[List[str]] = None) -> int:
    start = time.time()
    emails = load_uploader_emails()
    set_uploader_emails(emails)
    session = build_http_session()
    discovery = ArchiveDiscoveryClient(session, max_list_probe_id)
    targeted = [i.strip() for i in (only_items or []) if i.strip()]
    list_summaries: List[Dict[str, Any]] = []
    lists_n = uploads_n = 0
    accounts: List[str] = []

    if targeted:
        sources_by_id = {i: [source_dict("targeted", "(manual)")] for i in targeted}
    else:
        list_refs, list_summaries = discovery.fetch_user_lists(infobattalion_user)
        favs = discovery.fetch_user_favorites(infobattalion_user)
        ib_uploads = discovery.fetch_user_uploads(infobattalion_user)
        sammo = discovery.fetch_user_uploads(sammo_user)
        by_email = discovery.fetch_uploads_by_uploader_email(emails) if emails else {}
        lists_n, uploads_n = len(list_summaries), len(ib_uploads)
        accounts = [f"@{infobattalion_user.lstrip('@')}", f"@{sammo_user.lstrip('@')}"]
        sources_by_id = merge_sources(list_refs, favs, ib_uploads, sammo, by_email)
    uploader_check = "skipped_no_secret" if not emails else "performed"

    ids = sorted(sources_by_id)
    logger.info("Inspecting %d unique identifiers (workers=%d)...", len(ids), max_workers)
    cache: Dict[str, Optional[Dict[str, Any]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        for ident, payload in ex.map(lambda i: fetch_item_metadata(session, i), ids):
            cache[ident] = payload
    meta_errors = sum(1 for p in cache.values() if p is None or (isinstance(p, dict) and p.get("error")))
    by_status: Dict[str, int] = {}
    for p in cache.values():
        if isinstance(p, dict) and p.get("error"):
            by_status[redact(p["error"])[:40]] = by_status.get(redact(p["error"])[:40], 0) + 1
    meta_stats = {"requested": len(ids), "errors": meta_errors, "error_breakdown": by_status}

    lister = make_zip_lister(session)
    admitted: List[AdmittedMediaItem] = []
    gaps: List[GapReportEntry] = []
    for ident in ids:
        a, g = inspect_item(ident, cache.get(ident), sources_by_id[ident], lister)
        admitted.extend(a)
        gaps.extend(g)

    if do_verify_playable and admitted:
        kept: List[AdmittedMediaItem] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
            reasons = list(ex.map(lambda it: verify_playable(session, it), admitted))
        for it, reason in zip(admitted, reasons):
            if reason is None:
                kept.append(it)
            else:
                gaps.append(GapReportEntry(
                    identifier=it.identifier, file_name=it.file_name, duration_seconds=it.duration_seconds,
                    duration_raw=it.duration_raw, media_type=it.media_type, item_mediatype=it.item_mediatype,
                    genre=it.genre, show_name=it.show_name, file_title=it.file_title, sources=it.sources,
                    uploader_confirmed=it.uploader_confirmed, playable=False,
                    status="restricted" if reason == "download_403_restricted" else "unplayable",
                    gap_reasons=[reason], item_url=it.item_url, metadata_url=it.metadata_url))
        admitted = kept

    index, gap_report = build_reports(admitted, gaps, accounts=accounts, list_summaries=list_summaries,
                                      uploader_check=uploader_check, meta_stats=meta_stats, unique_ids=len(ids),
                                      elapsed=round(time.time() - start, 2), targeted=targeted)
    write_reports(output_dir, index, gap_report)
    code = compute_exit_code(lists_n, uploads_n, len(ids), meta_errors, len(admitted), bool(targeted))
    logger.info("Wrote reports to %s: %d admitted, %d gaps, exit=%d", output_dir, len(admitted), len(gaps), code)
    return code


# ---------------------------------------------------------------------------
# Offline self-test
# ---------------------------------------------------------------------------


def _meta(extra: Optional[Dict[str, Any]] = None, files: Optional[List[Dict[str, Any]]] = None,
          title: str = "Show", mediatype: str = "movies") -> Dict[str, Any]:
    md = {"identifier": "x", "title": title, "mediatype": mediatype}
    md.update(extra or {})
    return {"metadata": md, "files": files or []}


def run_self_test(output_dir: Path) -> int:
    class _Capture(logging.Handler):
        def __init__(self) -> None:
            super().__init__()
            self.lines: List[str] = []

        def emit(self, record: logging.LogRecord) -> None:
            self.lines.append(self.format(record))

    configure_logging()
    cap = _Capture()
    logger.addHandler(cap)
    set_uploader_emails(set())
    endpoint_log.clear()
    LIST = [source_dict("list", "@infobattalion", "Tv Classics", "1")]

    admitted_all: List[AdmittedMediaItem] = []
    gaps_all: List[GapReportEntry] = []

    # original four fixtures
    a, g = inspect_item("bonanza", _meta({"subject": ["Western", "Classic TV"], "collection": ["classic_tv"]}, [
        {"name": "bonanza_s01e01.mp4", "source": "original", "format": "h.264", "length": "2945.42"},
        {"name": "bonanza_s01e01_meta.xml", "format": "Metadata"}], "Bonanza - A Rose for Lotta"), LIST)
    assert len(a) == 1 and a[0].duration_seconds == 2945.42 and not g
    admitted_all += a
    a, g = inspect_item("cartoons", _meta({"genre": "Animation"}, [
        {"name": "saturday_cartoons_vol1.mkv", "format": "Matroska", "length": "01:24:15"}]),
        [source_dict("upload", "@sammo770")])
    assert len(a) == 1 and a[0].duration_seconds == 5055.0
    admitted_all += a
    a, g = inspect_item("nolen", _meta(files=[{"name": "h.mp4", "format": "MPEG4"}]), LIST)
    assert not a and "missing_or_unparseable_real_duration" in g[0].gap_reasons
    gaps_all += g
    a, g = inspect_item("restricted", _meta({"access-restricted-item": "true", "collection": ["inlibrary"]}, [
        {"name": "r.mp4", "format": "h.264", "length": "5400.0", "private": "true"}]), LIST)
    assert not a and "access_restricted_item_true" in g[0].gap_reasons
    gaps_all += g

    # a. zip-only item: members listed as gaps, never admitted (listing is mocked, no network)
    def fake_lister(ident: str, zipname: str) -> Tuple[List[str], Optional[str]]:
        return ["Show/S01E01.mp4", "Show/S01E02.mp4"], None
    a, g = inspect_item("zipitem", _meta(files=[{"name": "S01.zip", "format": "ZIP"}]), LIST, fake_lister)
    assert not a and len(g) == 2 and all("zip_member_duration_unverified" in x.gap_reasons for x in g)
    a, g = inspect_item("zipitem", _meta(files=[{"name": "S01.zip", "format": "ZIP"}]), LIST,
                        lambda i, z: ([], "HTTP 500"))
    assert not a and "zip_listing_failed:HTTP 500" in g[0].gap_reasons

    # b. renditions: one admitted, the h.264 mp4 (E2+E3)
    a, g = inspect_item("rend", _meta(files=[
        {"name": "e1.mkv", "format": "Matroska", "length": "1500", "source": "original"},
        {"name": "e1.mp4", "format": "h.264", "length": "1500", "source": "derivative"},
        {"name": "e1_512kb.mp4", "format": "512Kb MPEG4", "length": "1500", "source": "derivative"}]), LIST)
    assert len(a) == 1 and a[0].file_name == "e1.mp4", [x.file_name for x in a]
    # same name in different folders must NOT merge
    a, g = inspect_item("folders", _meta(files=[
        {"name": "A/ep1.mp4", "format": "h.264", "length": "100"},
        {"name": "B/ep1.mp4", "format": "h.264", "length": "200"}]), LIST)
    assert sorted(x.file_name for x in a) == ["A/ep1.mp4", "B/ep1.mp4"]

    # c. one record with three sources (E4)
    srcs = merge_sources({"i": [source_dict("list", "@a", "L", "1")]}, {"i": [source_dict("favorite", "@a", "Favorites")]},
                         {"i": [source_dict("upload", "@a")]})
    assert len(srcs["i"]) == 3
    a, g = inspect_item("i", _meta(files=[{"name": "e.mp4", "format": "h.264", "length": "900"}]), srcs["i"])
    assert len(a) == 1 and len(a[0].sources) == 3

    # d. lendinglibrary restricted (E6)
    a, g = inspect_item("lend", _meta({"collection": ["lendinglibrary"]}, [
        {"name": "e.mp4", "format": "h.264", "length": "900"}]), LIST)
    assert not a and g[0].status == "restricted"

    # e. mp3 inside a movies item -> audio (E7)
    a, g = inspect_item("mixed", _meta(files=[{"name": "a.mp3", "format": "VBR MP3", "length": "200"}]), LIST)
    assert a[0].media_type == "audio" and a[0].item_mediatype == "video"

    # f. season/episode (E9), including the spaced form seen in item death-valley-days
    assert parse_season_episode("Show S01E02") == (1, 2)
    assert parse_season_episode(None, "Death Valley Days S02 E02 Little Washington.mp4") == (2, 2)
    assert parse_season_episode("Home Improvement - 8x03 - X") == (8, 3)
    assert parse_season_episode("Just A Title") == (None, None)

    # g. uploader privacy (E8)
    secret = "a@example.com"
    set_uploader_emails({secret})
    a, g = inspect_item("up", _meta({"uploader": "A@Example.com"}, [
        {"name": "e.mp4", "format": "h.264", "length": "900"}]), LIST)
    assert a[0].uploader_confirmed is True
    logger.warning("request failed for https://archive.org/x?q=uploader%%3A%s ... %s", urllib.parse.quote(secret), secret)
    log_endpoint("scrape uploader:" + secret, 500, None, f"boom {secret}")
    index, gap_report = build_reports(a, [], accounts=[], list_summaries=[], uploader_check="performed",
                                      meta_stats={}, unique_ids=1, elapsed=0.0, targeted=[])
    blob = (json.dumps(index) + json.dumps(gap_report) + "\n".join(cap.lines)).lower()
    assert secret not in blob and "a%40example.com" not in blob, "uploader email leaked"
    set_uploader_emails(set())

    # h. exit codes (E5)
    assert compute_exit_code(0, 5, 10, 0, 5) == 2
    assert compute_exit_code(3, 0, 10, 0, 5) == 2
    assert compute_exit_code(3, 5, 10, 3, 5) == 3
    assert compute_exit_code(3, 5, 10, 0, 0) == 4
    assert compute_exit_code(3, 5, 10, 1, 5) == 0
    assert compute_exit_code(0, 0, 3, 0, 2, targeted=True) == 0

    index, gap_report = build_reports(admitted_all, gaps_all, accounts=[], list_summaries=[],
                                      uploader_check="skipped_no_secret", meta_stats={}, unique_ids=4,
                                      elapsed=0.0, targeted=[])
    index["self_test"] = gap_report["self_test"] = True
    write_reports(output_dir, index, gap_report)
    logger.removeHandler(cap)
    logger.info("Self-test passed (a-h plus original fixtures).")
    return 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Read-only Archive.org index probe.")
    p.add_argument("--output-dir", type=Path, default=Path("reports"))
    p.add_argument("--infobattalion-user", default="infobattalion")
    p.add_argument("--sammo-user", default="sammo770")
    p.add_argument("--max-workers", type=int, default=8)
    p.add_argument("--max-list-id", type=int, default=50)
    p.add_argument("--items", default="", help="comma-separated identifiers: targeted run, skips account discovery")
    p.add_argument("--verify-playable", action="store_true", help="1-byte ranged GET per admitted file")
    p.add_argument("--no-playwright-fallback", action="store_true", help="accepted for compatibility; no fallback exists")
    p.add_argument("--self-test", action="store_true")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging()
    if args.self_test:
        return run_self_test(args.output_dir)
    return run_probe(args.output_dir, args.infobattalion_user, args.sammo_user, args.max_workers,
                     args.max_list_id, args.verify_playable, [i for i in args.items.split(",") if i.strip()])


if __name__ == "__main__":
    sys.exit(main())
