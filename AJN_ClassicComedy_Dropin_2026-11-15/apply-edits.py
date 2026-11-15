#!/usr/bin/env python3
"""AJN Comedy network. Run from the repo root AFTER the Shows+Westerns drop-in is applied. Idempotent; stops on any missing anchor."""
import json, pathlib, sys
def ed(path, a, b, marker):
    p = pathlib.Path(path); s = p.read_text(encoding='utf-8')
    if marker in s: print('already:', path, marker); return
    assert s.count(a) == 1, f'anchor not found/unique in {path}: {a[:70]} (is the Westerns drop-in applied?)'
    p.write_text(s.replace(a, b), encoding='utf-8'); print('applied:', path)
P = 'server/classicNetworkPublication.ts'
ed(P, "import bakedWesterns from '../src/data/classicWesternsPublication.json';", "import bakedWesterns from '../src/data/classicWesternsPublication.json';\nimport bakedComedy from '../src/data/classicComedyPublication.json';", 'bakedComedy')
ed(P, "const westerns = createPublicationReader(bakedWesterns);", "const westerns = createPublicationReader(bakedWesterns);\nconst comedy = createPublicationReader(bakedComedy);", 'createPublicationReader(bakedComedy)')
ed(P, "export function classicWesternsChannel(", "export function classicComedyChannel(nowMs = Date.now()): ScheduleChannel {\n  return networkChannel(comedy, 'classic-comedy', 'AJN Comedy', 'classic-tv', 'Classic TV', nowMs);\n}\nexport function classicWesternsChannel(", 'classicComedyChannel')
ed('guideRegistry.ts', "classicMoviesChannel, classicWesternsChannel }", "classicMoviesChannel, classicWesternsChannel, classicComedyChannel }", 'classicComedyChannel }')
ed('guideRegistry.ts', "classicWesternsChannel(),...classic", "classicWesternsChannel(),classicComedyChannel(),...classic", 'classicComedyChannel(),...')
ed('server/libraryIndex.ts', "|| ch.id === 'classic-westerns') continue;", "|| ch.id === 'classic-westerns' || ch.id === 'classic-comedy') continue;", "'classic-comedy'")
ed('tools/compile-classic-network.mts', "'classic-westerns': 'src/data/classicWesternsPublication.json' }", "'classic-westerns': 'src/data/classicWesternsPublication.json', 'classic-comedy': 'src/data/classicComedyPublication.json' }", "classic-comedy")
ed('tools/check-classic-network-publication.mjs', "'classic-westerns': 'src/data/classicWesternsPublication.json' }", "'classic-westerns': 'src/data/classicWesternsPublication.json', 'classic-comedy': 'src/data/classicComedyPublication.json' }", "classic-comedy")
c = pathlib.Path('config/classic-networks.json'); d = json.loads(c.read_text(encoding='utf-8'))
if 'classic-comedy' in d['networks']: print('already: config')
else:
    d['networks']['classic-comedy'] = json.loads(pathlib.Path('tools/comedy-network.json').read_text(encoding='utf-8'))
    c.write_text(json.dumps(d, indent=2) + '\n', encoding='utf-8'); print('applied: config/classic-networks.json (added classic-comedy only)')
