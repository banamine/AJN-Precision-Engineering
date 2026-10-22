#!/usr/bin/env python3
"""
AJN H1 build v2. Offline: reads phase2-ranked.json + pass-1 candidates.json, writes manifest/playlists/reports.
Nothing is deleted: anything uncertain gets status "deferred_owner_decision" with reasons.

  python3 -I build_h1_v2.py RANKED.json CANDIDATES.json OUT_DIR [--confirm type-confirmation.json] [--overrides owner-overrides.json]
"""
import argparse, collections, datetime, hashlib, json, os, re, statistics, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_lib import ID_RX, classify_item, clean_title, title_from_identifier, file_kind, title_flags
from extra_channels_lib import row_id

DEFER = "deferred_owner_decision"
BAD_FORMAT_DISP = {"unclassified_format_needs_phase3_metadata", "possible_original_needs_derivative_check"}

def v1_title(ident):   # what build v1 produced for items without a title (for before/after reporting)
    t = re.sub(r"_(\d{6,8})$", "", ident); t = re.sub(r"[-_.]+", " ", t).strip()
    return " ".join(w.capitalize() if w.islower() else w for w in t.split())

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "unsorted"

def decide(cls, ident, title, fdisp=None, extra_reasons=()):
    reasons = list(extra_reasons)
    if not ID_RX.match(ident): reasons.append("invalid_identifier_chars")
    reasons += cls["conflicts"]
    if cls["evidence"] == 0: reasons.append("no_evidence_for_type")
    if fdisp in BAD_FORMAT_DISP: reasons.append("format_needs_derivative_or_unclassified")
    if not title.strip(): reasons.append("empty_title")
    if reasons: return DEFER, reasons
    ready = cls["mediatypeKnown"] and cls["formatsKnown"] and cls["mediaKind"] in ("video", "audio")
    return ("ready" if ready else "provisional"), []

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ranked"); ap.add_argument("cands"); ap.add_argument("out")
    ap.add_argument("--confirm"); ap.add_argument("--overrides")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "playlists"), exist_ok=True)
    ranked = json.load(open(a.ranked))["items"]; cands = json.load(open(a.cands))
    cand_ids = {c["identifier"] for c in cands}
    overrides = json.load(open(a.overrides)) if a.overrides and os.path.exists(a.overrides) else {}
    prev_conf = json.load(open(a.confirm)) if a.confirm and os.path.exists(a.confirm) else {}
    items, title_changes = [], []

    for s in ranked:
        ident, srcs = s["identifier"], s["sourceNames"]
        if ident in cand_ids: continue                       # emitted per-episode below
        cats = list(dict.fromkeys(m["category"] for m in s["listMemberships"]))
        category = cats[0] if cats else "Unsorted - review"
        raw = s["title"]; before = raw if raw else v1_title(ident)
        title = clean_title(raw) if raw else title_from_identifier(ident)
        if title != before: title_changes.append({"id": f"ajn-ia-{ident}", "before": before, "after": title})
        cls = classify_item(ident, title, cats[0] if cats else None, s["mediatype"], s["formats"])
        extra = []
        if srcs == ["creator digitalfolklore"]: extra.append("creator_digitalfolklore_deferred")
        elif len(srcs) == 1 and "virginian" in srcs[0]: extra.append("virginian_search_title_not_series_match")
        status, reasons = decide(cls, ident, title, s["formatDisposition"], extra)
        items.append({
            "id": f"ajn-ia-{ident}", "identifier": ident, "title": title,
            "titleSource": "archive_search" if raw else "derived_from_identifier", "titleFlags": title_flags(title),
            "category": category, "categories": cats, "contentType": cls["contentType"], "contentTypeAlt": cls["contentTypeAlt"],
            "mediaKind": cls["mediaKind"], "mediatype": s["mediatype"], "formats": s["formats"], "itemSizeBytes": s["itemSize"],
            "sources": srcs, "signals": cls["signals"],
            "playback": {"type": "archive-embed", "url": f"https://archive.org/embed/{ident}"},
            "detailsUrl": f"https://archive.org/details/{ident}", "directUrl": None, "fileRowId": None,
            "licenseurl": s["licenseurl"], "rightsReview": "unreviewed", "restrictionState": "unchecked",
            "status": status, "deferReasons": reasons})

    for c in cands:                                          # Centennial episodes (direct files)
        m = re.match(r"^(\d+)\s*-\s*(.+)\.mp4$", c["file"]); num, name = (m.group(1), m.group(2)) if m else ("00", c["file"])
        title = clean_title(f'{c["tidyTitle"]} - {num} - {name}')
        kind, problem = file_kind(c["file"], c["format"])
        cls = classify_item(c["identifier"], title, c["category"], c["mediaType"], [])
        status, reasons = decide(cls, c["identifier"], title, None, [problem] if problem else [])
        items.append({
            "id": f'ajn-ia-{c["identifier"]}--e{num}', "identifier": c["identifier"], "title": title, "titleSource": "pass1_candidate", "titleFlags": [],
            "category": c["category"], "categories": [c["category"]], "contentType": "episode", "contentTypeAlt": [],
            "mediaKind": kind, "mediatype": c["mediaType"], "formats": [c["format"]], "itemSizeBytes": c["size"],
            "sources": [c["source"]], "signals": cls["signals"] + ["file:" + kind],
            "playback": {"type": "direct-file", "url": c["url"]}, "detailsUrl": c["sourceDetailUrl"], "directUrl": c["url"],
            "fileRowId": row_id(c["identifier"], c["file"]), "licenseurl": None, "rightsReview": "unreviewed",
            "restrictionState": "unchecked", "runtimeSeconds": c["runtimeSeconds"], "status": status, "deferReasons": reasons})

    # owner overrides are explicit decisions; recorded, never silent
    for it in items:
        o = overrides.get(it["id"])
        if o and o.get("status") in ("ready", "provisional", DEFER):
            it["override"] = {"from": it["status"], "to": o["status"], "note": o.get("note", "")}
            it["status"] = o["status"]
            if o["status"] != DEFER: it["deferReasons"] = [f"(overridden) {r}" for r in it["deferReasons"]]

    active = [i for i in items if i["status"] != DEFER]
    # ---- per-type confirmation: one tested item stands for every item with the same playback type + media kind
    groups = collections.defaultdict(list)
    for i in active: groups[f'{i["playback"]["type"]}:{i["mediaKind"]}'].append(i)
    conf = {}
    for tk, grp in sorted(groups.items()):
        pool = [g for g in grp if g["status"] == "ready"] or grp
        sizes = [g["itemSizeBytes"] for g in pool if g["itemSizeBytes"]]
        med = statistics.median(sizes) if sizes else 0
        test = min(pool, key=lambda g: (abs((g["itemSizeBytes"] or med) - med), g["id"]))
        old = prev_conf.get(tk, {})
        conf[tk] = {"confirmed": bool(old.get("confirmed", False)), "itemCount": len(grp),
                    "testItemId": old.get("testItemId", test["id"]), "testUrl": old.get("testUrl", test["playback"]["url"]),
                    "note": old.get("note", "Set confirmed=true after this one item plays in the playlist; all items of this type then inherit it.")}
    for i in items:
        tk = f'{i["playback"]["type"]}:{i["mediaKind"]}'
        i["typeKey"] = tk if i["status"] != DEFER else None
        i["typeCheck"] = None if i["status"] == DEFER else ("confirmed" if conf[tk]["confirmed"] else "awaiting_type_check")
    items.sort(key=lambda x: (x["status"] == DEFER, x["category"], x["title"].lower(), x["id"]))
    active = [i for i in items if i["status"] != DEFER]

    # ---- validation (every entry, before anything is written to a playlist)
    problems = []
    REQ = ("id", "identifier", "title", "category", "contentType", "mediaKind", "playback", "status", "rightsReview")
    ids = [i["id"] for i in items]
    if len(ids) != len(set(ids)): problems.append("duplicate ids")
    urls = [i["playback"]["url"] for i in active]
    if len(urls) != len(set(urls)): problems.append("duplicate playback urls among active items")
    for i in items:
        if any(k not in i or i[k] in (None, "") for k in REQ): problems.append(f"missing field {i['id']}")
    for i in active:
        if i["deferReasons"] and not i.get("override"): problems.append(f"active with reasons {i['id']}")
        if not ID_RX.match(i["identifier"]): problems.append(f"bad identifier {i['id']}")
        if i["playback"]["type"] == "direct-file" and not i["fileRowId"]: problems.append(f"no row id {i['id']}")
    assert not problems, problems[:5]

    gen = datetime.date.today().isoformat()
    cnt = lambda key, rows: dict(collections.Counter(key(r) for r in rows).most_common())
    manifest = {"schema": "ajn-h1-build/2", "generated": gen, "archiveRequestsMade": 0,
                "counts": {"items": len(items), "active": len(active), "deferred": len(items) - len(active),
                           "byStatus": cnt(lambda r: r["status"], items), "byContentType": cnt(lambda r: r["contentType"], active),
                           "byTypeKey": cnt(lambda r: r["typeKey"], active)}, "items": items}
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    deferred = [{"id": i["id"], "identifier": i["identifier"], "title": i["title"], "sources": i["sources"],
                 "mediatype": i["mediatype"], "itemSizeBytes": i["itemSizeBytes"], "reasons": i["deferReasons"]} for i in items if i["status"] == DEFER]
    json.dump({"status": DEFER, "count": len(deferred), "byReason": cnt(lambda r: r["reasons"][0], deferred), "items": deferred},
              open(os.path.join(a.out, "deferred.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(conf, open(os.path.join(a.out, "type-confirmation.json"), "w"), indent=1)
    json.dump(overrides, open(os.path.join(a.out, "owner-overrides.json"), "w"), indent=1)
    json.dump({"count": len(title_changes), "changes": title_changes}, open(os.path.join(a.out, "title-changes.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"generated": gen, "problems": problems, "counts": manifest["counts"],
               "checks": ["unique ids", "unique active playback urls", "required fields", "identifier charset", "no active item with unresolved defer reasons"],
               "typeConfirmation": {k: v["confirmed"] for k, v in conf.items()},
               "notVerified": ["playback of any item", "restriction/loan/dark state (restrictionState=unchecked)", "rights/licensing",
                               "file-level metadata for embed items (needs /metadata)"]},
              open(os.path.join(a.out, "validation-report.json"), "w"), indent=1)

    def m3u(path, rows):
        with open(path, "w", encoding="utf-8") as f:
            f.write("#EXTM3U\n# archive-embed entries are archive.org/embed pages: use an iframe-aware player.\n")
            for i in rows:
                t = i["title"].replace('"', "'")
                f.write(f'#EXTINF:{i.get("runtimeSeconds", -1)} tvg-id="{i["id"]}" tvg-name="{t}" group-title="{i["category"]}" '
                        f'ajn-type="{i["contentType"]}" ajn-status="{i["status"]}",{t}\n{i["playback"]["url"]}\n')
    m3u(os.path.join(a.out, "playlists", "ALL.m3u"), active)
    for ct in sorted({i["contentType"] for i in active}):
        m3u(os.path.join(a.out, "playlists", f"type-{slug(ct)}.m3u"), [i for i in active if i["contentType"] == ct])
    by_id = {i["id"]: i for i in items}
    m3u(os.path.join(a.out, "playlists", "TEST-ONE-PER-TYPE.m3u"), [by_id[v["testItemId"]] for v in conf.values()])

    sums = []
    for root, _, files in os.walk(a.out):
        for fn in sorted(files):
            if fn == "SHA256SUMS.txt": continue
            p = os.path.join(root, fn); sums.append(f"{hashlib.sha256(open(p,'rb').read()).hexdigest()}  {os.path.relpath(p, a.out)}")
    open(os.path.join(a.out, "SHA256SUMS.txt"), "w").write("\n".join(sorted(sums)) + "\n")
    print(json.dumps(manifest["counts"], indent=1)); print("title changes", len(title_changes), "| type keys", {k: v["itemCount"] for k, v in conf.items()})

if __name__ == "__main__":
    main()
