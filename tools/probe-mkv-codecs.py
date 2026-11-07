#!/usr/bin/env python3
"""CLI tool to probe Archive .mkv codecs and seek index (Cues) using HTTP Range reads."""

import argparse
import collections
from datetime import datetime, timezone
import importlib.util
import json
import os
import sys
import urllib.parse

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)

# Import local mkv_codec_probe
import mkv_codec_probe

# Import ArchiveClient from build-infobattalion-lists
spec = importlib.util.spec_from_file_location(
    "infobattalion_builder",
    os.path.join(here, "build-infobattalion-lists.py"),
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
ArchiveClient = builder.ArchiveClient
ArchiveFetchStopped = builder.ArchiveFetchStopped


def save_output(out_path, files_map):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    payload = {
        "schema": "ajn.mkvCodecVerified.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "files": files_map,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, sort_keys=True)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser(description="Probe Archive .mkv codec & cues admissibility")
    parser.add_argument("--item", action="append", required=True, dest="items", help="Archive identifier to probe")
    parser.add_argument("--out", default=os.path.join(root, "src", "data", "mkvCodecVerified.json"), help="Output JSON path")
    parser.add_argument("--max-starts", type=int, default=1500, help="Max physical Archive request starts")
    parser.add_argument("--ledger", default=os.path.join(root, "reports", "mkv-probe", "request-log.jsonl"), help="Ledger path")
    parser.add_argument("--recheck-unverified", action="store_true", help="Recheck previously unverified files")
    args = parser.parse_args()

    # Load existing database
    existing_files = {}
    if os.path.isfile(args.out):
        try:
            with open(args.out, "r", encoding="utf-8") as f:
                d = json.load(f)
                if isinstance(d, dict) and "files" in d and isinstance(d["files"], dict):
                    existing_files = d["files"]
        except Exception as e:
            print(f"Warning: could not read existing {args.out}: {e}", file=sys.stderr)

    os.makedirs(os.path.dirname(os.path.abspath(args.ledger)), exist_ok=True)
    client = ArchiveClient(max_starts=args.max_starts)
    client.ledger_path = args.ledger

    all_candidates = []
    # For each item: client.get("https://archive.org/metadata/<id>") once
    print(f"Fetching metadata for {len(args.items)} item(s)...")
    for item_id in args.items:
        meta_url = f"https://archive.org/metadata/{item_id}"
        try:
            body = client.get(meta_url)
            meta = json.loads(body)
        except ArchiveFetchStopped as e:
            print(f"Archive fetch stopped fetching metadata for {item_id}: {e}", file=sys.stderr)
            sys.exit(3)
        except Exception as e:
            print(f"Error fetching metadata for {item_id}: {e}", file=sys.stderr)
            continue

        raw_files = meta.get("files", [])
        # Sibling derivative maps
        mp4_derivatives_by_orig = {}
        stems_with_ia_mp4 = set()
        for f in raw_files:
            fname = f.get("name", "")
            fname_lower = fname.lower()
            if fname_lower.endswith(".ia.mp4"):
                stems_with_ia_mp4.add(fname_lower[:-7])
            if f.get("source") == "derivative" and fname_lower.endswith(".mp4") and f.get("original"):
                mp4_derivatives_by_orig[f["original"]] = fname

        for f in raw_files:
            name = f.get("name", "")
            if not name.lower().endswith(".mkv"):
                continue
            if f.get("source") != "original":
                continue
            priv = str(f.get("private", "")).lower() in ("true", "1")
            if priv:
                continue

            stem = name.rsplit(".", 1)[0].lower()
            # NO sibling MP4 copy (same stem + ".ia.mp4", or derivative .mp4 whose original == name)
            if stem in stems_with_ia_mp4:
                continue
            if name in mp4_derivatives_by_orig:
                continue

            all_candidates.append((item_id, f))

    total_candidates = len(all_candidates)
    cached_count = 0
    to_probe = []

    for item_id, f in all_candidates:
        name = f["name"]
        key = f"/download/{item_id}/{name}"
        md5 = f.get("md5")
        if key in existing_files:
            existing_entry = existing_files[key]
            if existing_entry.get("md5") == md5 and existing_entry.get("status") == "verified":
                cached_count += 1
                continue
            if not args.recheck-unverified and existing_entry.get("status") == "unverified" and existing_entry.get("md5") == md5:
                cached_count += 1
                continue
        to_probe.append((item_id, f))

    print(f"Candidates found: {total_candidates}")
    print(f"Cached (already verified): {cached_count}")
    print(f"Remaining to probe: {len(to_probe)}")
    print(f"Request estimate: ~{len(to_probe) * 2} starts (redirect + range) x 1.55 s (~{round(len(to_probe) * 2 * 1.55, 1)} s)")

    files_map = dict(existing_files)
    probed_count = 0
    playable_count = 0
    rejected_reasons = collections.Counter()
    unverified_count = 0

    for i, (item_id, f) in enumerate(to_probe):
        name = f["name"]
        key = f"/download/{item_id}/{name}"
        md5 = f.get("md5")
        size = int(f.get("size") or 0)
        length_val = float(f.get("length")) if f.get("length") else None

        encoded_path = "/".join(urllib.parse.quote(seg) for seg in name.split("/"))
        url = f"https://archive.org/download/{item_id}/{encoded_path}"

        stopped_err = None
        try:
            res = mkv_codec_probe.probe(lambda a, b: client.get_range(url, a, b))
        except ArchiveFetchStopped as e:
            stopped_err = e
            res = {"status": "unverified", "reason": f"{type(e).__name__}: {str(e)}"}
        except Exception as e:
            res = {"status": "unverified", "reason": f"{type(e).__name__}: {str(e)}"}

        probed_count += 1
        probed_at = datetime.now(timezone.utc).isoformat()

        if res.get("status") == "verified":
            entry = {
                "md5": md5,
                "size": size,
                "length": length_val,
                "status": "verified",
                "browserPlayable": bool(res.get("browserPlayable")),
                "videoNorm": res.get("videoNorm"),
                "audioNorm": res.get("audioNorm"),
                "videoCodec": res.get("videoCodec"),
                "audioCodec": res.get("audioCodec"),
                "audioTracks": res.get("audioTracks", 0),
                "hasCues": bool(res.get("hasCues")),
                "probedAt": probed_at,
            }
            if not entry["browserPlayable"] or not entry["hasCues"]:
                if "reason" in res:
                    entry["reason"] = res["reason"]
                    rejected_reasons[res["reason"]] += 1
                elif not entry["hasCues"]:
                    entry["reason"] = "no seek index (Cues)"
                    rejected_reasons["no seek index (Cues)"] += 1
            else:
                playable_count += 1
        else:
            unverified_count += 1
            reason = res.get("reason", "unknown error")
            entry = {
                "md5": md5,
                "size": size,
                "length": length_val,
                "status": "unverified",
                "browserPlayable": False,
                "hasCues": False,
                "reason": reason,
                "probedAt": probed_at,
            }
            rejected_reasons[f"unverified: {reason}"] += 1

        files_map[key] = entry

        # Save after every 25 files
        if probed_count % 25 == 0:
            save_output(args.out, files_map)
            print(f"[{probed_count}/{len(to_probe)}] saved checkpoint to {args.out}")

        if stopped_err:
            save_output(args.out, files_map)
            print(f"ArchiveFetchStopped during probe of {name}: {stopped_err}", file=sys.stderr)
            sys.exit(3)

    # Final save
    save_output(args.out, files_map)

    print("\n--- Summary ---")
    print(f"Total candidates: {total_candidates}")
    print(f"Cached: {cached_count}")
    print(f"Probed: {probed_count}")
    print(f"Verified-playable: {playable_count}")
    print(f"Unverified: {unverified_count}")
    print("Rejections/Unverified by reason:")
    for reason, count in rejected_reasons.most_common():
        print(f"  {count}: {reason}")


if __name__ == "__main__":
    main()
