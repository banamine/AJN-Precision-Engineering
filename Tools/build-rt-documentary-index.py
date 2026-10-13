#!/usr/bin/env python3
"""Build src/data/rtDocumentaryIndex.json: the RT "Documentary" pool from the
Internet Archive TV News collection.

Only identifiers that Archive's own search returned are written (never built
from a pattern). Sequential requests, >= 1.5 s apart, Retry-After honoured.
Stdlib only. Re-run any time; output is deterministic for a given Archive state.

  python tools/build-rt-documentary-index.py [--out src/data/rtDocumentaryIndex.json]
"""
import argparse, json, re, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

QUERY = 'collection:tvnews AND identifier:RT_*_Documentary'
SEARCH = 'https://archive.org/advancedsearch.php'
ROWS = 1000
GAP = 1.6
ID_RE = re.compile(r'^RT_(\d{8})_(\d{6})_Documentary$')
UA = 'AJN-Precision-Engineering/rt-index'
stats = {'requests': 0, 'r429': 0, 'r503': 0}
_last = [0.0]

def get(url):
    for attempt in range(6):
        wait = _last[0] + GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        stats['requests'] += 1
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429: stats['r429'] += 1
            if e.code == 503: stats['r503'] += 1
            if e.code in (429, 503, 502, 504):
                ra = e.headers.get('Retry-After')
                time.sleep(min(float(ra), 60) if ra and ra.replace('.', '', 1).isdigit() else 10 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(5 * (attempt + 1))
    raise RuntimeError('giving up: ' + url)

def runtime_seconds(v):
    if v is None: return None
    s = str(v).strip()
    if re.fullmatch(r'\d+(\.\d+)?', s): return int(float(s))
    try: n = [float(x) for x in s.split(':')]
    except ValueError: return None
    sec = 0.0
    for x in n: sec = sec * 60 + x
    return int(sec) if sec > 0 else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='src/data/rtDocumentaryIndex.json')
    a = ap.parse_args()
    # advancedsearch refuses deep paging past 10,000 hits, so walk one month at a time
    # (a month is well under 1,000 items) and record every month's count, zeros included.
    items, months = {}, {}
    now = datetime.now(timezone.utc)
    total = 0
    for year in range(2013, now.year + 1):
        for month in range(1, 13):
            if (year, month) > (now.year, now.month): break
            ym = f'{year}{month:02d}'
            q = f'collection:tvnews AND identifier:RT_{ym}*_Documentary'
            page, got = 1, 0
            while True:
                qs = urllib.parse.urlencode([('q', q), ('fl[]', 'identifier'), ('fl[]', 'runtime'), ('fl[]', 'language'),
                                              ('sort[]', 'identifier asc'), ('rows', ROWS), ('page', page), ('output', 'json')])
                d = get(SEARCH + '?' + qs)['response']
                for x in d['docs']:
                    m = ID_RE.match(x.get('identifier', ''))
                    if not m: continue
                    lang = x.get('language')
                    if isinstance(lang, list): lang = lang[0] if lang else None
                    rt = x.get('runtime')
                    if isinstance(rt, list): rt = rt[0] if rt else None
                    items[x['identifier']] = [m.group(1) + '_' + m.group(2), runtime_seconds(rt), (str(lang).lower() if lang else '')]
                got += len(d['docs'])
                if not d['docs'] or got >= d['numFound']: break
                page += 1
            months[f'{year}-{month:02d}'] = d['numFound']
            total += d['numFound']
        print(f'{year}: running total {total}, kept {len(items)}', file=sys.stderr, flush=True)
    rows = sorted(items.values())
    out = {
        'schema': 'ajn.rtDocumentaryIndex.v1',
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'query': QUERY,
        'note': 'Rows are [YYYYMMDD_HHMMSS, runtimeSeconds|null, language]. Identifier = RT_<row[0]>_Documentary. Every row came from an Archive search result.',
        'numFound': total, 'count': len(rows), 'monthCounts': months, 'requests': stats,
        'items': rows,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(json.dumps({k: out[k] for k in ('numFound', 'count', 'requests')}), file=sys.tar: tools/verify-movies-classics-manifest.py: 