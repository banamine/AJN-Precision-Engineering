#!/usr/bin/env python3
"""Probe every feed in src/data/newsRssSources.json from THIS computer (the cloud sandbox cannot reach them).
Read-only. Writes tools/metadata/news_feed_probe.md. Run:  py tools/probe_news_feeds.py
Reports HTTP status, item count and newest item age per feed. A feed that fails is reported as failed, never hidden."""
import json, sys, time, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (AJN feed probe)"}

def newest(root):
    best = None
    for el in root.iter():
        tag = el.tag.split('}')[-1]
        if tag in ('pubDate', 'published', 'updated') and el.text:
            try:
                t = parsedate_to_datetime(el.text) if tag == 'pubDate' else datetime.fromisoformat(el.text.replace('Z', '+00:00'))
                t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
                best = t if best is None or t > best else best
            except Exception:
                pass
    return best

def probe(url):
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            body = r.read(2_000_000); status = r.status
        root = ET.fromstring(body)
        items = [e for e in root.iter() if e.tag.split('}')[-1] in ('item', 'entry')]
        n = newest(root)
        age = f"{(datetime.now(timezone.utc) - n).total_seconds() / 3600:.1f} h" if n else "unknown"
        return status, len(items), age, f"{(time.time() - t0) * 1000:.0f} ms", ""
    except Exception as e:
        return "FAIL", 0, "-", f"{(time.time() - t0) * 1000:.0f} ms", str(e)[:70]

def main():
    feeds = json.loads((ROOT / 'src/data/newsRssSources.json').read_text(encoding='utf-8'))['feeds']
    rows, bad = [], 0
    for f in feeds:
        s, n, age, ms, err = probe(f['url'])
        ok = s == 200 and n > 0
        bad += 0 if ok else 1
        rows.append(f"| {f['name']} | {f['category']} | {'yes' if f['collectedByDigest'] else 'no'} | {s} | {n} | {age} | {ms} | {err} |")
        print(('OK   ' if ok else 'FAIL ') + f['name'], s, n, age)
    out = ["# News feed probe", f"Run at {datetime.now(timezone.utc).isoformat(timespec='seconds')} from this computer.", "",
           "| Feed | Category | Digest collects | HTTP | Items | Newest item age | RTT | Error |", "|---|---|---|---|---|---|---|---|", *rows, "",
           f"{len(feeds) - bad} of {len(feeds)} feeds returned items."]
    (ROOT / 'tools/metadata/news_feed_probe.md').write_text('\n'.join(out) + '\n', encoding='utf-8')
    print(f"\n{len(feeds) - bad}/{len(feeds)} ok -> tools/metadata/news_feed_probe.md")
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
