"""Turn the scraper's channel.json into src/data/bannedVideoSnapshot.json (slim, no test blobs, no signed URLs).

Usage:  python tools/bannedvideo-slim.py path/to/channel.json src/data/bannedVideoSnapshot.json
Channel network tags are kept from the existing snapshot when it exists; new channels default to "other".
Edit the "channels" list in the output by hand to retag a channel (ajn | rav | other) or to mark datedTitles.
"""
import json, sys, os

src, dst = sys.argv[1], sys.argv[2]
raw = json.load(open(src, encoding="utf-8"))
old = {}
if os.path.exists(dst):
    try:
        old = {c["name"]: c for c in json.load(open(dst, encoding="utf-8")).get("channels", [])}
    except Exception:
        old = {}

videos = sorted(raw["videos"], key=lambda v: (int(v["page"]), int(v["rank"])))
items, names = [], []
for i, v in enumerate(videos, start=1):
    test = v.get("test")
    if isinstance(test, dict) and test.get("pass") is False:
        continue  # only ship items the scraper's checks passed
    items.append({
        "id": v["id"],
        "rank": i,
        "title": v["title"].strip(),
        "channel": v["channel"].strip(),
        "durationSec": round(float(v["duration_seconds"]), 1),
        "thumbnailUrl": v["thumbnail"],
        "watchUrl": v["watch_url"],
        "maxHeight": int(v["max_height"]) if str(v.get("max_height", "")).isdigit() else None,
    })
    if v["channel"].strip() not in names:
        names.append(v["channel"].strip())

defaults = {"Banned Media Archive": {"network": "ajn", "datedTitles": True}}
channels = []
for n in names:
    base = old.get(n) or defaults.get(n) or {}
    channels.append({"name": n, "network": base.get("network", "other"), "datedTitles": bool(base.get("datedTitles", False))})

out = {
    "version": 1,
    "source": "https://banned.video/trending",
    "pages": raw.get("pages", [1, 2, 3]),
    "scrapedAt": raw["scraped_at"],
    "channels": channels,
    "items": items,
}
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"wrote {dst}: {len(items)} items, {len(channels)} channels, scrapedAt {out['scrapedAt']}")
