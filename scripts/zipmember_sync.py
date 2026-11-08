#!/usr/bin/env python3
"""Merge verified fast-start MP4 entries into data/zipmember-fastcopies.json.
Reads manifest.json from each Archive '<item>-faststart' item (written by ajn-zipmember-remux).
An entry is added ONLY if: url is https://archive.org/download/<id>/<file>.mp4, durationSec > 0,
and a byte-range request returns HTTP 206 (so seeking works). Anything else is reported and left out.
Never invents a duration. Usage: zipmember_sync.py --targets a,b [--out data/zipmember-fastcopies.json]"""
import argparse, json, re, sys, urllib.request, urllib.error

URL_RE = re.compile(r'^https://archive\.org/download/([^/?#]+)/([^/?#]+\.mp4)$', re.I)

def get(url, rng=None, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ajn-zipmember-sync', **({'Range': rng} if rng else {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read(2048 if rng else None)
        except urllib.error.HTTPError as e:
            last = (e.code, b'')
        except Exception as e:  # network
            last = (0, str(e).encode())
    return last

def load_manifest(target, local=None):
    if local:
        return json.load(open(f'{local}/{target}.json'))
    st, body = get(f'https://archive.org/download/{target}/manifest.json')
    if st != 200: raise SystemExit(f'::error::{target}: manifest.json HTTP {st}')
    return json.loads(body)

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--targets', required=True)
    ap.add_argument('--out', default='data/zipmember-fastcopies.json')
    ap.add_argument('--local', help='test only: read <dir>/<target>.json instead of archive.org')
    ap.add_argument('--no-range-check', action='store_true', help='test only')
    a = ap.parse_args(argv)
    try: current = json.load(open(a.out))
    except FileNotFoundError: current = []
    if not isinstance(current, list): raise SystemExit(f'{a.out} is not a JSON array')
    have = {e.get('url') for e in current if isinstance(e, dict)}
    added, rejected = [], []
    for t in [x.strip() for x in a.targets.split(',') if x.strip()]:
        if not re.fullmatch(r'[A-Za-z0-9._-]+', t): rejected.append((t, 'bad item id')); continue
        for e in load_manifest(t, a.local):
            url = (e or {}).get('url', ''); dur = (e or {}).get('durationSec')
            if not URL_RE.match(url or ''): rejected.append((url, 'not a direct archive .mp4 url')); continue
            if not isinstance(dur, (int, float)) or dur <= 0: rejected.append((url, 'no real duration')); continue
            if url in have: continue
            if not a.no_range_check:
                st, _ = get(url, rng='bytes=0-1023')
                if st != 206: rejected.append((url, f'range request returned HTTP {st}, want 206')); continue
            added.append({k: e[k] for k in ('url', 'durationSec', 'bytes', 'source') if k in e}); have.add(url)
    merged = sorted(current + added, key=lambda e: e['url'])
    json.dump(merged, open(a.out, 'w'), indent=1); open(a.out, 'a').write('\n')
    print(f'added {len(added)}, rejected {len(rejected)}, total {len(merged)}')
    for u, why in rejected: print(f'  rejected: {u} -> {why}')
    return 0

if __name__ == '__main__': sys.exit(main())
