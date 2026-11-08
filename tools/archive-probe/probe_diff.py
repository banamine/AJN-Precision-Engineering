#!/usr/bin/env python3
"""
Archive probe diff (tools/archive-probe/probe_diff.py)
======================================================

Read-only. Compares reports/probe/library_index.json (+ gap_report.json next to
it) with what the app already uses, and answers:

  * in_index_not_in_app             Archive items the probe admitted that no app manifest references
  * in_app_not_in_index             identifiers the app uses that the probe did not admit (dead /
                                    restricted / unplayable candidates, with the probe's gap reasons)
  * skipped_or_excluded_but_in_index  items listed in reports/infobattalion-lists.json as skipped/
                                    excluded/dark/needs_decision, and whether the probe admits them
  * show_search                     per-show counts for the named shows

Never prints or writes anything about emails.
Usage:
  python tools/archive-probe/probe_diff.py --index reports/probe/library_index.json --repo . --out reports/probe/probe_diff.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set, Tuple

DEFAULT_SHOWS = ["rockford", "perry mason", "death valley days", "all in the family", "odd couple",
                 "beverly hillbillies"]
FIXED_FILES = ["src/data/extraChannelsManifest.json", "src/data/classicNetworkCatalog.json",
               "src/data/showInfo.json", "reports/infobattalion-lists.json"]
ARCHIVE_URL_RE = re.compile(r"archive\.org/(?:download|details)/([^/?#\"\s]+)", re.IGNORECASE)
ID_KEYS = {"identifier", "archiveidentifier", "archiveidentifiers"}
SKIP_LIST_KEYS = ("skipped_in_app", "dark", "excluded", "needs_decision")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def collect_identifiers(node: Any) -> Set[str]:
    """Identifier-valued keys plus identifiers inside archive.org download/details URLs."""
    found: Set[str] = set()
    if isinstance(node, dict):
        for k, v in node.items():
            if str(k).lower() in ID_KEYS:
                vals = v if isinstance(v, list) else [v]
                found.update(str(x).strip() for x in vals if isinstance(x, (str, int)) and str(x).strip())
            found |= collect_identifiers(v)
    elif isinstance(node, list):
        for v in node:
            found |= collect_identifiers(v)
    elif isinstance(node, str):
        for m in ARCHIVE_URL_RE.finditer(node):
            found.add(m.group(1))
    return found


def collect_skipped(node: Any) -> Dict[str, str]:
    """identifier -> list it was found in (e.g. 'skipped_in_app.tv'). Only the SKIP_LIST_KEYS lists count."""
    out: Dict[str, str] = {}

    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, f"{path}.{k}")
        elif isinstance(value, list):
            for v in value:
                if isinstance(v, str):
                    out.setdefault(v.strip(), path)
                else:
                    walk(v, path)
        elif isinstance(value, str):
            for ident in collect_identifiers(value):
                out.setdefault(ident, path)

    if isinstance(node, dict):
        for key in SKIP_LIST_KEYS:
            if key in node:
                walk(node[key], key)
    return out


def app_files(repo: Path) -> Tuple[List[Path], List[str]]:
    present: List[Path] = []
    missing: List[str] = []
    for rel in FIXED_FILES:
        p = repo / rel
        (present if p.exists() else missing).append(p if p.exists() else rel)  # type: ignore[arg-type]
    data_dir = repo / "src" / "data"
    if data_dir.is_dir():
        for p in sorted(data_dir.glob("*.json")):
            if "manifest" in p.name.lower() and p not in present:
                present.append(p)
    return present, [str(m) for m in missing]


def show_matches(records: Iterable[Dict[str, Any]], pattern: str) -> List[Dict[str, Any]]:
    rx = re.compile(re.escape(pattern).replace(r"\ ", r"[\s._-]*"), re.IGNORECASE)
    return [r for r in records
            if any(rx.search(str(r.get(k) or "")) for k in ("show_name", "file_name", "file_title"))]


def verdict(admitted: int, gaps: int) -> str:
    if admitted:
        return "present"
    return "gaps_only" if gaps else "absent_from_index"


def run_diff(index_path: Path, repo: Path, out_path: Path, shows: List[str]) -> Dict[str, Any]:
    index = load_json(index_path)
    gap_path = index_path.with_name("gap_report.json")
    gap_report = load_json(gap_path) if gap_path.exists() else {"gaps": []}
    items: List[Dict[str, Any]] = index.get("items", [])
    gaps: List[Dict[str, Any]] = gap_report.get("gaps", [])

    files, files_missing = app_files(repo)
    app_ids: Set[str] = set()
    files_read: List[str] = []
    skipped: Dict[str, str] = {}
    for p in files:
        try:
            data = load_json(p)
        except (OSError, ValueError) as exc:
            files_missing.append(f"{p} (unreadable: {type(exc).__name__})")
            continue
        files_read.append(str(p.relative_to(repo)))
        app_ids |= collect_identifiers(data)
        if p.name == "infobattalion-lists.json":
            skipped = collect_skipped(data)

    admitted_ids = {i["identifier"] for i in items}
    by_id: Dict[str, List[Dict[str, Any]]] = {}
    for i in items:
        by_id.setdefault(i["identifier"], []).append(i)

    in_index_not_in_app = [
        {"identifier": ident, "show_name": rows[0].get("show_name"), "files": len(rows),
         "total_duration_seconds": round(sum(r.get("duration_seconds", 0) for r in rows), 1),
         "sources": rows[0].get("sources")}
        for ident, rows in sorted(by_id.items()) if ident not in app_ids]

    gaps_by_id: Dict[str, List[Dict[str, Any]]] = {}
    for g in gaps:
        gaps_by_id.setdefault(g["identifier"], []).append(g)
    in_app_not_in_index = [
        {"identifier": ident, "status": "no_probe_record" if ident not in gaps_by_id else gaps_by_id[ident][0]["status"],
         "gap_reasons": sorted({r for g in gaps_by_id.get(ident, []) for r in g.get("gap_reasons", [])})}
        for ident in sorted(app_ids) if ident not in admitted_ids]

    skipped_report = [
        {"identifier": ident, "listed_in": where, "admitted_by_probe": ident in admitted_ids,
         "gap_reasons": sorted({r for g in gaps_by_id.get(ident, []) for r in g.get("gap_reasons", [])})}
        for ident, where in sorted(skipped.items())]

    show_search: Dict[str, Any] = {}
    for show in shows:
        a, g = show_matches(items, show), show_matches(gaps, show)
        show_search[show] = {
            "admitted_count": len(a), "gap_count": len(g),
            "total_duration_seconds": round(sum(r.get("duration_seconds", 0) for r in a), 1),
            "identifiers": sorted({r["identifier"] for r in a + g}),
            "verdict": verdict(len(a), len(g))}

    result = {"files_read": files_read, "files_missing": files_missing,
              "counts": {"app_identifiers": len(app_ids), "admitted_identifiers": len(admitted_ids)},
              "in_index_not_in_app": in_index_not_in_app, "in_app_not_in_index": in_app_not_in_index,
              "skipped_or_excluded_but_in_index": skipped_report, "show_search": show_search}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def self_test() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "src" / "data").mkdir(parents=True)
        (root / "reports" / "probe").mkdir(parents=True)
        (root / "src" / "data" / "extraChannelsManifest.json").write_text(json.dumps({"channels": [
            {"id": "c1", "rows": [{"identifier": "in-both", "file": "a.mp4"},
                                  {"identifier": "dead-one", "file": "b.mp4"}]}]}))
        (root / "src" / "data" / "showInfo.json").write_text(json.dumps({"shows": [
            {"title": "X", "links": {"archiveIdentifiers": ["from-showinfo"]}}]}))
        (root / "src" / "data" / "otherManifest.json").write_text(json.dumps(
            {"u": "https://archive.org/download/from-url/ep.mp4"}))
        (root / "reports" / "infobattalion-lists.json").write_text(json.dumps(
            {"skipped_in_app": {"tv": ["skip-but-ok", "in-both"]}, "excluded": {"tv_no_playable_runtime": ["excl-gap"]},
             "channels": {"ignored": 1}}))
        item = lambda ident, show, f, d: {"identifier": ident, "show_name": show, "file_name": f,
                                          "file_title": None, "duration_seconds": d, "sources": []}
        (root / "reports" / "probe" / "library_index.json").write_text(json.dumps({"items": [
            item("in-both", "Odd Couple", "e1.mp4", 100.0), item("new-one", "Death Valley Days", "S02 E02.mp4", 1500.0),
            item("skip-but-ok", "Perry Mason", "pm.mp4", 50.0)]}))
        (root / "reports" / "probe" / "gap_report.json").write_text(json.dumps({"gaps": [
            {"identifier": "excl-gap", "show_name": "All in the Family", "file_name": "x.mp4", "file_title": None,
             "status": "incomplete_metadata", "gap_reasons": ["missing_or_unparseable_real_duration"]}]}))
        out = run_diff(root / "reports" / "probe" / "library_index.json", root,
                       root / "reports" / "probe" / "probe_diff.json", DEFAULT_SHOWS)
        assert [x["identifier"] for x in out["in_index_not_in_app"]] == ["new-one", "skip-but-ok"] or \
            [x["identifier"] for x in out["in_index_not_in_app"]] == ["new-one"], out["in_index_not_in_app"]
        dead = {x["identifier"]: x for x in out["in_app_not_in_index"]}
        assert "dead-one" in dead and dead["dead-one"]["status"] == "no_probe_record"
        assert "from-showinfo" in dead and "from-url" in dead and "in-both" not in dead
        sk = {x["identifier"]: x for x in out["skipped_or_excluded_but_in_index"]}
        assert sk["skip-but-ok"]["admitted_by_probe"] is True and sk["excl-gap"]["admitted_by_probe"] is False
        assert sk["excl-gap"]["gap_reasons"] == ["missing_or_unparseable_real_duration"]
        ss = out["show_search"]
        assert ss["odd couple"]["verdict"] == "present" and ss["death valley days"]["admitted_count"] == 1
        assert ss["all in the family"]["verdict"] == "gaps_only" and ss["rockford"]["verdict"] == "absent_from_index"
        assert "src/data/otherManifest.json" in out["files_read"]
        assert any("classicNetworkCatalog" in m for m in out["files_missing"])
    print("probe_diff self-test passed")
    return 0


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compare probe output with the app's manifests (read-only).")
    ap.add_argument("--index", type=Path, default=Path("reports/probe/library_index.json"))
    ap.add_argument("--repo", type=Path, default=Path("."))
    ap.add_argument("--out", type=Path, default=Path("reports/probe/probe_diff.json"))
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.index.exists():
        print(f"index not found: {args.index}", file=sys.stderr)
        return 1
    result = run_diff(args.index, args.repo, args.out, DEFAULT_SHOWS)
    print(f"wrote {args.out}: {len(result['in_index_not_in_app'])} new, {len(result['in_app_not_in_index'])} "
          f"app-only, {len(result['files_missing'])} input files missing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
