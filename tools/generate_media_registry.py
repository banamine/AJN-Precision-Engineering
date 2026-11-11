#!/usr/bin/env python3
"""Step 1 of Entry 045/046: build a read-only media registry CSV from the manifests already in the repo, plus a coverage report.

  python tools/generate_media_registry.py            # writes tools/metadata/media_master_registry.csv + media_registry_coverage.md

Zero app changes, no network. Output is deterministic (no clock). Nothing here is guessed: a field the source does not state is left
EMPTY and counted in the coverage report. `search_synonyms` comes from the one thesaurus the app already uses
(src/search/genreThesaurus.ts, parsed from that file so there is no second copy to drift).
Stream URLs are CONSTRUCTED from the archive identifier and file name (https://archive.org/download/<id>/<file>); they are not probed."""
import csv, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'src' / 'data'
OUT_DIR = ROOT / 'tools' / 'metadata'
COLUMNS = ['id', 'title', 'media_type', 'sub_genre', 'era_decade', 'color_format', 'creator_host_artist', 'search_synonyms', 'stream_url', 'ingest_date', 'source']
SYN_SEP = '|'


def load(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


# ---- thesaurus, read from the TypeScript source of truth -------------------------------------------------
def load_thesaurus():
    src = (ROOT / 'src' / 'search' / 'genreThesaurus.ts').read_text(encoding='utf-8')
    genres = []
    for m in re.finditer(r"\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*categoryIds:\s*\[([^\]]*)\],\s*terms:\s*\[([^\]]*)\],\s*aliases:\s*\[([^\]]*)\]\s*\}", src):
        items = lambda s: re.findall(r"'([^']*)'", s)
        genres.append({'id': m.group(1), 'label': m.group(2), 'cats': items(m.group(3)), 'terms': items(m.group(4)), 'aliases': items(m.group(5))})
    if len(genres) < 8:
        sys.exit(f'could not parse src/search/genreThesaurus.ts (found {len(genres)} genres); the file format changed, update this parser')
    return genres


def synonyms(genres, category_ids, text, genre_text=''):
    """Aliases of every genre pool this record belongs to: by library category id, by a pool term appearing in its own text, or because
    its stated genre IS one of the pool's words (e.g. concert genre "Rock"). Words this script adds itself are never matched against."""
    low = ' ' + re.sub(r'[^a-z0-9& ]+', ' ', text.lower()) + ' '
    gt = re.sub(r'[^a-z0-9& ]+', ' ', genre_text.lower()).strip()
    out, seen = [], set()
    for g in genres:
        hit = any(c in g['cats'] for c in category_ids) or any((' ' + t + ' ') in low for t in g['terms']) or (gt != '' and (gt in g['aliases'] or gt == g['label'].lower()))
        if hit:
            for a in [g['label'].lower()] + g['aliases']:
                if a not in seen:
                    seen.add(a); out.append(a)
    return SYN_SEP.join(out)


def decade_of(year):
    return f'{year // 10 * 10}s' if isinstance(year, int) and 1800 < year < 2100 else ''


def year_from_date(s):
    m = re.match(r'^(\d{4})', str(s or ''))
    return int(m.group(1)) if m else None


def color_of(title):
    t = (title or '').lower()
    return 'colorized_restoration' if re.search(r'colori[sz]ed|colorization', t) else ''  # never guess b_and_w / color: unknown stays empty


def dl(identifier, file):
    return f'https://archive.org/download/{identifier}/{file}' if identifier and file else (f'https://archive.org/details/{identifier}' if identifier else '')


def build():
    G = load_thesaurus(); rows = []

    lib = load('libraryIndex.json')
    for r in lib['items']:
        cats = r.get('categoryIds') or []
        rows.append({'id': r['id'], 'title': r.get('title', ''), 'media_type': 'audiobook' if 'audiobooks' in cats else 'old_time_radio' if 'old-time-radio' in cats else r.get('mediaType', ''),
                     'sub_genre': cats[0] if cats else '', 'era_decade': decade_of(r.get('decade') if isinstance(r.get('decade'), int) else r.get('year')),
                     'color_format': color_of(r.get('title')), 'creator_host_artist': r.get('originalCreator', '') or '',
                     'search_synonyms': synonyms(G, cats, f"{r.get('title','')} {r.get('description','')}"),
                     'stream_url': dl(r.get('identifier'), (r.get('path') or '').split('/')[-1] if r.get('path') else r.get('file')), 'ingest_date': (lib.get('generatedAt') or '')[:10], 'source': 'libraryIndex.json'})

    cp = load('concertPoolsManifest.json')
    for pool in cp['pools']:
        for c in pool['concerts']:
            first = (c.get('tracks') or [{}])[0].get('f', '')
            rows.append({'id': f"concert:{c['id']}", 'title': c.get('title', ''), 'media_type': 'live_concert', 'sub_genre': pool.get('genre', ''), 'era_decade': decade_of(year_from_date(c.get('date'))),
                         'color_format': '', 'creator_host_artist': c.get('creator', '') or '',
                         'search_synonyms': synonyms(G, [], c.get('title', ''), pool.get('genre', '')), 'stream_url': dl(c['id'], first), 'ingest_date': '', 'source': 'concertPoolsManifest.json'})

    fm = load('fmBroadcastChannels.json')
    for b in fm['broadcasts']:
        first = b.get('tracks')
        rows.append({'id': f"fm:{b['id']}", 'title': b.get('title', ''), 'media_type': 'fm_broadcast', 'sub_genre': '', 'era_decade': decade_of(year_from_date(b.get('date'))),
                     'color_format': '', 'creator_host_artist': b.get('creator', '') or '', 'search_synonyms': synonyms(G, [], b.get('title', '')),
                     'stream_url': dl(b['id'], ''), 'ingest_date': '', 'source': 'fmBroadcastChannels.json'})

    for ch in load('archiveAudioChannels.json'):
        rows.append({'id': f"audio-channel:{ch['id']}", 'title': ch.get('name', ''), 'media_type': 'audio_channel', 'sub_genre': ch.get('group', ''), 'era_decade': '', 'color_format': '', 'creator_host_artist': '',
                     'search_synonyms': synonyms(G, [], f"{ch.get('name','')} {ch.get('group','')}"), 'stream_url': dl(ch.get('itemId'), ''), 'ingest_date': ch.get('verifiedAt', ''), 'source': 'archiveAudioChannels.json'})

    for s in load('podcastSources.json')['sources']:
        rows.append({'id': f"podcast:{s['id']}", 'title': s.get('name', ''), 'media_type': 'podcast', 'sub_genre': '', 'era_decade': '', 'color_format': '', 'creator_host_artist': s.get('publisher', '') or '',
                     'search_synonyms': synonyms(G, [], s.get('name', '')), 'stream_url': s.get('feedUrl', ''), 'ingest_date': s.get('verifiedAt', ''), 'source': 'podcastSources.json'})

    # one record per CHANNEL (the manifest's per-episode rows are not catalog entries; there are ~tens of thousands of them)
    for ch in load('extraChannelsManifest.json')['channels']:
        cats = [ch.get('guideId', '')]
        rows.append({'id': f"channel:{ch['id']}", 'title': ch.get('name', ''), 'media_type': 'channel', 'sub_genre': ch.get('group', ''), 'era_decade': '', 'color_format': '', 'creator_host_artist': '',
                     'search_synonyms': synonyms(G, cats, f"{ch.get('name','')} {ch.get('group','')}"), 'stream_url': '', 'ingest_date': '', 'source': 'extraChannelsManifest.json'})
    return rows


def coverage(rows):
    n = len(rows); L = []
    L.append('# Media registry coverage (generated by tools/generate_media_registry.py)\n')
    L.append(f'Total records: **{n}**. An empty field means the source file does not state it (nothing is guessed).\n')
    by = Counter(r['source'] for r in rows)
    L.append('## By source and field (records missing the field / records)\n')
    L.append('| source | records | no sub_genre | no era_decade | no synonyms | no creator | no stream_url |')
    L.append('|---|---:|---:|---:|---:|---:|---:|')
    for src in sorted(by):
        rs = [r for r in rows if r['source'] == src]; miss = lambda k: sum(1 for r in rs if not r[k])
        L.append(f"| {src} | {len(rs)} | {miss('sub_genre')} | {miss('era_decade')} | {miss('search_synonyms')} | {miss('creator_host_artist')} | {miss('stream_url')} |")
    L.append('')
    L.append('## By media_type\n'); L.append('| media_type | records | with synonyms | unclassified (no sub_genre AND no synonyms) |'); L.append('|---|---:|---:|---:|')
    for mt in sorted({r['media_type'] for r in rows}):
        rs = [r for r in rows if r['media_type'] == mt]
        L.append(f"| {mt} | {len(rs)} | {sum(1 for r in rs if r['search_synonyms'])} | {sum(1 for r in rs if not r['sub_genre'] and not r['search_synonyms'])} |")
    L.append('')
    tot_unc = sum(1 for r in rows if not r['search_synonyms'])
    L.append(f'**Records with no search synonyms at all: {tot_unc} of {n}** (these only match by title text today).\n')
    L.append('## Concert sub-genres: how many reach a thesaurus pool (0 = typing the genre word finds them only by title)\n')
    L.append('| sub_genre | concerts | with synonyms |'); L.append('|---|---:|---:|')
    cg = Counter(r['sub_genre'] for r in rows if r['media_type'] == 'live_concert')
    for g, c in sorted(cg.items(), key=lambda x: -x[1]):
        L.append(f"| {g or '(none)'} | {c} | {sum(1 for r in rows if r['media_type']=='live_concert' and r['sub_genre']==g and r['search_synonyms'])} |")
    L.append('')
    dup = [k for k, v in Counter(r['id'] for r in rows).items() if v > 1]
    L.append(f'## Integrity\n\n- Duplicate ids: {len(dup)}' + (f' ({", ".join(dup[:5])})' if dup else ''))
    L.append(f"- Empty titles: {sum(1 for r in rows if not r['title'])}")
    L.append('- Stream URLs are constructed from archive identifiers, not probed; run the existing archive probe before trusting any of them.')
    return '\n'.join(L) + '\n'


def main():
    rows = build(); OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / 'media_master_registry.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS); w.writeheader(); w.writerows(rows)
    rep = coverage(rows); (OUT_DIR / 'media_registry_coverage.md').write_text(rep, encoding='utf-8'); print(rep)


if __name__ == '__main__':
    main()
