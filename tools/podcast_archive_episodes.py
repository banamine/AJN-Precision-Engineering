"""Builds src/data/podcastArchiveEpisodes.json: Archive-hosted episodes that belong to a podcast source.
A source opts in with  "archiveFolder": {"item": "<archive id>", "folder": "Podcasts/The Quash/"}  in src/data/podcastSources.json.
Episodes come from the packaged Archive manifest (title, bytes, duration are Archive's own metadata; Archive gives no air date).
Run:  python tools/podcast_archive_episodes.py   (from the repo root)"""
import json, sys
src = json.load(open('src/data/podcastSources.json', encoding='utf-8'))
man = json.load(open('src/data/archiveItemManifest.json', encoding='utf-8'))
out = {}
for s in src['sources']:
    af = s.get('archiveFolder')
    if not af: continue
    if af['item'] != man['item']:
        sys.exit(f"{s['id']}: manifest is for item {man['item']!r}, source wants {af['item']!r}")
    rows = [x for x in man['items'] if x.get('kind') == 'audio' and (x.get('path') or '').startswith(af['folder']) and x['path'].lower().endswith('.mp3')]
    bad = [x['path'] for x in rows if not x.get('durationSeconds')]
    if bad: sys.exit(f"{s['id']}: files without a duration in the manifest: {bad[:3]}")
    out[s['id']] = {'item': af['item'], 'episodes': sorted(
        ({'path': x['path'], 'title': x['title'], 'bytes': x['bytes'], 'durationSeconds': round(x['durationSeconds'])} for x in rows), key=lambda e: e['title'].lower())}
    print(s['id'], len(rows), 'episodes')
json.dump(out, open('src/data/podcastArchiveEpisodes.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
