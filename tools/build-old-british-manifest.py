#!/usr/bin/env python3
"""Build src/data/oldBritishTvManifest.json from Archive.org items uploaded by @old_british_tv689.

Input : tools/old_british_tv_ids.txt (one Archive identifier per line)
Output: src/data/oldBritishTvManifest.json
Usage : python tools/build-old-british-manifest.py [--meta-dir DIR]   (DIR caches /metadata/<id> JSON)

Rules (real data only, no invented durations):
  * video files only (.mp4 .m4v .webm .ogv); metadata/thumbnail sources ignored
  * one programme per file stem; preference: .ia.mp4 derivative > h.264 derivative > original .mp4 > .m4v
  * duration = Archive's `length` for the chosen file; skipped when absent
  * dark / access-restricted items are skipped
"""
import json, os, re, sys, time, urllib.parse, urllib.request, concurrent.futures as cf, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = os.path.join(ROOT, 'tools', 'old_british_tv_ids.txt')
OUT = os.path.join(ROOT, 'src', 'data', 'oldBritishTvManifest.json')
meta_dir = sys.argv[sys.argv.index('--meta-dir') + 1] if '--meta-dir' in sys.argv else os.path.join(ROOT, '.cache', 'obt-meta')
os.makedirs(meta_dir, exist_ok=True)
VID = re.compile(r'\.(mp4|m4v|webm|ogv)$', re.I)

def fetch(i):
    fp = os.path.join(meta_dir, i + '.json')
    if os.path.exists(fp) and os.path.getsize(fp) > 50:
        return json.load(open(fp))
    for a in range(4):
        try:
            r = urllib.request.urlopen(urllib.request.Request('https://archive.org/metadata/' + urllib.parse.quote(i), headers={'User-Agent': 'AJN-tool'}), timeout=40)
            data = r.read(); open(fp, 'wb').write(data); return json.loads(data)
        except Exception:
            time.sleep(1.5 * (a + 1))
    raise SystemExit('metadata fetch failed: ' + i)

# (channel id, name, description) in display order; first matching rule wins.
CHANNELS = [
    ('obt-actor-clips', 'Victoria Shalet Clips', 'Scenes, adverts and interviews'),
    ('obt-adverts', 'British TV Adverts & Breaks', 'UK commercial breaks and idents, 1980s-90s'),
    ('obt-soaps', 'British Soaps', 'Neighbours, Home & Away, Brookside, Doctors and more'),
    ('obt-childrens', "British Children's TV", "Children's and family series"),
    ('obt-gameshows', 'British Game & Variety Shows', 'Supermarket Sweep, The Generation Game, Noel\'s House Party'),
    ('obt-comedy', 'British Comedy & Sitcoms', 'Sitcoms and comedy'),
    ('obt-supernatural', 'British Ghost Stories & Horror', 'Supernatural and ghost stories'),
    ('obt-plays', 'British Plays & Anthologies', 'Play for Today, Screen Two, Screen One and anthology plays'),
    ('obt-mystery', 'British Mystery & Crime', 'Detectives, whodunnits and thrillers'),
    ('obt-period', 'British Period Drama', 'Costume and classic serials'),
    ('obt-drama', 'British Drama', 'Contemporary drama serials'),
    ('obt-other', 'British TV Archive', 'Documentaries, interviews and other programmes'),
]

def classify(i, title, subj):
    s = ' | '.join(subj).lower(); t = (title + ' ' + i).lower()
    has = lambda *w: any(x in s or x in t for x in w)
    if 'victoria shalet' in s or i.startswith('victoria-shalet'): return 'obt-actor-clips'
    if 'adverts' in s or 'commercials' in s or 'adverts' in i: return 'obt-adverts'
    if has('soap opera', 'soap', 'neighbours', 'home-and-away', 'home-away', 'brookside', 'coronation', 'doctors-'): return 'obt-soaps'
    if has("children's series", 'kids tv', 'cbbc', 'bagpuss', 'trumpton', 'camberwick', 'chigley', 'paddington', 'worzel', 'animation'): return 'obt-childrens'
    if has('game show', 'generation-game', 'supermarket-sweep', 'house-party', 'dave-allen', 'entertainment'): return 'obt-gameshows'
    if has('sitcom', 'comedy', 'humour'): return 'obt-comedy'
    if has('supernatural', 'ghost story', 'horror', 'ghost'): return 'obt-supernatural'
    if has('anthology', 'play for today', 'screen-two', 'screen-one', 'wednesday-play', 'playhouse', 'play-of-the', 'armchair', 'theatre-night'): return 'obt-plays'
    if has('mystery', 'whodunnit', 'detective', 'thriller', 'cop show', 'crime'): return 'obt-mystery'
    if has('period drama', 'costume drama', 'period'): return 'obt-period'
    if has('drama'): return 'obt-drama'
    return 'obt-other'

def stem(n): return re.sub(r'(\.ia)?\.(mp4|m4v|webm|ogv)$', '', n, flags=re.I)
def rank(f):
    n = f['name'].lower()
    if f.get('source') == 'derivative' and n.endswith('.ia.mp4'): return 0
    if f.get('source') == 'derivative' and n.endswith('.mp4'): return 1
    if n.endswith('.mp4'): return 2
    return 3

ids = [l.strip() for l in open(IDS) if l.strip()]
with cf.ThreadPoolExecutor(6) as ex: metas = dict(zip(ids, ex.map(fetch, ids)))

items, skipped = [], collections.Counter()
for i in ids:
    m = metas[i]; md = m.get('metadata', {})
    if m.get('is_dark') or md.get('access-restricted-item') == 'true' or not m.get('files'):
        skipped['dark-or-empty'] += 1; continue
    subj = md.get('subject', []); subj = [subj] if isinstance(subj, str) else subj
    title = md.get('title', i)
    year = (str(md.get('date', ''))[:4] or None)
    ch = classify(i, title, subj)
    thumb = '__ia_thumb.jpg' if any(f['name'] == '__ia_thumb.jpg' for f in m['files']) else None
    groups = collections.defaultdict(list)
    for f in m['files']:
        if f.get('source') == 'metadata' or not VID.search(f['name']): continue
        groups[stem(f['name'])].append(f)
    multi = len(groups) > 1
    for s, fs in sorted(groups.items()):
        f = sorted(fs, key=rank)[0]
        try: dur = float(f.get('length'))
        except (TypeError, ValueError): dur = 0
        if dur <= 0: skipped['no-duration'] += 1; continue
        items.append({
            'id': 'obt:' + i + ':' + s, 'channelId': ch, 'identifier': i, 'file': f['name'],
            'title': s if multi else title, 'series': title, 'year': year,
            'bytes': int(f.get('size') or 0), 'durationSeconds': round(dur, 2), 'thumb': thumb,
        })

def natural(t): return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', t)]
# Series together, episodes in natural order (Episode 2 before Episode 10).
items.sort(key=lambda x: (x['channelId'], natural(re.sub(r'^(the|a|an) ', '', x['series'].lower())), natural(x['title'])))

used = {x['channelId'] for x in items}
manifest = {
    'schema': 'ajn.oldBritishTvManifest.v1', 'source': '@old_british_tv689',
    'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'itemCount': len(ids), 'channels': [{'id': c, 'name': n, 'description': d} for c, n, d in CHANNELS if c in used],
    'items': items,
}
json.dump(manifest, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
by = collections.Counter(x['channelId'] for x in items)
print('items', len(ids), 'programmes', len(items), 'skipped', dict(skipped), 'bytes', os.path.getsize(OUT))
for c, n, _ in CHANNELS: print(f'  {c:18} {by[c]:4}  {n}')
