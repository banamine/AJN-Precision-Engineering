"""Lists Archive items whose cover image is unusable (tiny waveform strip or nearly black), so the app shows genre art instead.
Run: python tools/music_art_check.py [base_url]  -> writes src/data/musicNoArt.json
Needs Pillow. Reads the live schedule and fetches each item's __ia_thumb.jpg through the app's own proxy."""
import json, sys, io, urllib.request, urllib.parse, concurrent.futures as cf
from PIL import Image, ImageStat
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://ajn-precision-engineering.ai.studio').rstrip('/')
DARK, STRIP_RATIO = 40, 3.0
sched = json.load(urllib.request.urlopen(BASE + '/api/schedule?guide=audio-podcasts', timeout=120))
items = {}
for c in sched['channels']:
    if c.get('group') != 'Music' or not c['programs']: continue
    parts = (c['programs'][0].get('archivePath') or '').split('/')
    if len(parts) > 2 and parts[1] == 'download': items[urllib.parse.unquote(parts[2])] = c['name']
def look(item):
    u = BASE + '/api/archive/proxy?path=' + urllib.parse.quote('/download/' + item + '/__ia_thumb.jpg', safe='')
    try:
        im = Image.open(io.BytesIO(urllib.request.urlopen(u, timeout=60).read()))
        luma = ImageStat.Stat(im.convert('L')).mean[0]
        return item, im.size, round(luma), (im.size[0] / im.size[1] >= STRIP_RATIO) or luma < DARK
    except Exception as e:
        return item, None, None, None  # unknown: leave the real cover alone
with cf.ThreadPoolExecutor(6) as ex: rows = list(ex.map(look, items))
bad = sorted(r[0] for r in rows if r[3])
json.dump({'rule': f'strip (width/height >= {STRIP_RATIO}) or mean luma < {DARK}', 'noArt': bad}, open('src/data/musicNoArt.json', 'w'), indent=1)
for r in rows:
    if r[3]: print('NO-ART', r[0], r[1], r[2], items[r[0]][:40])
print(len(rows), 'items checked;', len(bad), 'without usable art;', sum(1 for r in rows if r[1] is None), 'unreachable')
