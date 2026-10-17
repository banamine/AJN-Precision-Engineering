#!/usr/bin/env python3
"""Build src/data/archiveShowSourcesManifest.json: extra Archive.org sources for existing Classic TV channels.

Only the vetted identifiers in SOURCES are used; every playable video file in them is listed with Archive's real duration.
Rules match build-old-british-manifest.py (derivative preferred, one programme per file stem, dark items skipped).
Usage: python tools/build-show-sources-manifest.py [--meta-dir DIR]
"""
import json, os, re, sys, time, urllib.parse, urllib.request, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'archiveShowSourcesManifest.json')
meta_dir = sys.argv[sys.argv.index('--meta-dir') + 1] if '--meta-dir' in sys.argv else os.path.join(ROOT, '.cache', 'show-meta')
os.makedirs(meta_dir, exist_ok=True)
VID = re.compile(r'\.(mp4|m4v|webm|ogv)$', re.I)

# Explicit, hand-vetted allowlist (search results were too noisy to trust: fan edits, nursery rhymes, duplicate uploads).
# channelId -> (channel name, [Archive identifiers]). Add an identifier here and re-run to extend a channel.
SOURCES = {
 'item-adventures-of-the-flying-cadets': ('Adventures of the Flying Cadets', ['adventures-of-the-flying-cadets-1943-complete-serial-all-13-chapters-johnny-downs']),
 'item-black-sheep-squadron': ('Black Sheep Squadron', ['ba-baa_blacksheep_Lando18']),
 'item-bojack-horseman': ('BoJack Horseman', ['readme_20250925']),
 'item-corner-gas': ('Corner Gas', ['corner-gas-complete_202507']),
 'item-doc-cold-war-24-part-series': ('Cold War (24-part series)', ['Cold_War_1998_CNN_Kenneth_Branagh']),
 'item-doc-full-circle-with-michael-palin': ('Full Circle with Michael Palin', ['vid-20231115-112856', 'vid-20231116-112904', 'vid-20231117-123429']),
 'item-doc-smithsonian': ('Smithsonian', ['solomons-temple-544', 'solomons-temple-366', 'smithsonian-america-in-color-1of6-the-wild-west-anydownloader']),
 'item-doc-trafficked-with-mariana-van-zeller': ('Trafficked with Mariana van Zeller', ['prkcitut-Trafficked_with_Mariana_van_Zeller']),
 'item-high-incident': ('High Incident', ['high-incident-1.07']),
 'item-home-improvement': ('Home Improvement', ['home-improvement-tv-series']),
 'item-north-and-south': ('North and South', ['north-and-south-complete-collection-book-2-love-and-war-part-3']),
 'item-pirates-of-the-high-seas': ('Pirates of the High Seas', ['pirates.of.the.-high.-seas.-0']),
 'item-sanford-and-son': ('Sanford and Son', ['sanford-and-son-s1', 'od-and-so-n-06-r-01']),
 'item-the-angry-beavers': ('The Angry Beavers', ['the-angry-beavers-pilot-snowbound-hq', 'The_Angry_Beavers_Final_Ede_Bye_Bye_Beaver_High_Quality.flv']),
 'item-the-fighting-marines': ('The Fighting Marines', ['the-fighting-marines-serial']),
 'item-the-life-and-times-of-grizzly-adams': ('The Life and Times of Grizzly Adams', ['grizzly-adams', 'grizzly-adams-s-2-e-24-once-upon-a-starry-night-pt-1', 'grizzlyadamsmovie']),
}
# Searched, nothing usable found on Archive: Cheers, Schitt's Creek, Mantracker, Catastrophe: Natural Disasters,
# Forensics Catching the Killer, bumpers (a generic "commercial break" search returns thousands of unrelated films).

def get(url, retries=4):
    for a in range(retries):
        try: return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'AJN-tool'}), timeout=40).read()
        except Exception: time.sleep(1.5 * (a + 1))
    raise SystemExit('fetch failed: ' + url)

def meta(i):
    fp = os.path.join(meta_dir, urllib.parse.quote(i, safe='') + '.json')
    if not (os.path.exists(fp) and os.path.getsize(fp) > 50): open(fp, 'wb').write(get('https://archive.org/metadata/' + urllib.parse.quote(i)))
    return json.load(open(fp))

def stem(n): return re.sub(r'(\.ia)?\.(mp4|m4v|webm|ogv)$', '', n, flags=re.I)
def rank(f):
    n = f['name'].lower()
    if f.get('source') == 'derivative' and n.endswith('.ia.mp4'): return 0
    if f.get('source') == 'derivative' and n.endswith('.mp4'): return 1
    if n.endswith('.mp4'): return 2
    return 3
MIN_SECONDS = {'item-the-angry-beavers': 300, 'item-doc-trafficked-with-mariana-van-zeller': 120}
DEFAULT_MIN = 600  # episodes only: drops credits, promos, stubs
def natural(t): return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', t)]

out, report, seen = [], [], set()
for cid, (cname, ids) in SOURCES.items():
    n_items = 0
    for i in dict.fromkeys(ids):
        m = meta(i); md = m.get('metadata', {})
        if m.get('is_dark') or md.get('access-restricted-item') == 'true': continue
        groups = collections.defaultdict(list)
        for f in m.get('files', []):
            if f.get('source') != 'metadata' and VID.search(f['name']): groups[stem(f['name'])].append(f)
        multi = len(groups) > 1; added = 0
        for s, fs in groups.items():
            f = sorted(fs, key=rank)[0]
            try: dur = float(f.get('length'))
            except (TypeError, ValueError): dur = 0
            if dur < MIN_SECONDS.get(cid, DEFAULT_MIN): continue
            key = (cid, re.sub(r'[^a-z0-9]', '', (s if multi else md.get('title', i)).lower()), round(dur))
            if key in seen: continue          # same programme uploaded twice
            seen.add(key)
            out.append({'id': f'src:{i}:{s}', 'channelId': cid, 'channelName': cname, 'identifier': i, 'file': f['name'],
                        'title': (s if multi else md.get('title', i)), 'series': md.get('title', i),
                        'bytes': int(f.get('size') or 0), 'durationSeconds': round(dur, 2),
                        'thumb': '__ia_thumb.jpg' if any(x['name'] == '__ia_thumb.jpg' for x in m['files']) else None})
            added += 1
        if added: n_items += 1
    report.append((cname, len(ids), n_items, sum(1 for x in out if x['channelId'] == cid)))
out.sort(key=lambda x: (x['channelId'], natural(x['series']), natural(x['title'])))
json.dump({'schema': 'ajn.archiveShowSourcesManifest.v1', 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'items': out}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
for r in report: print(f'{r[0]:40} matched={r[1]:3} items_with_video={r[2]:3} programmes={r[3]}')
print('total programmes', len(out))
