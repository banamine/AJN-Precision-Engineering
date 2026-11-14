#!/usr/bin/env python3
"""Apply the Shows + Westerns edits to an AJN Precision Engineering checkout. Idempotent. Run from the repo root."""
import sys, os
EDITS = [
 ("src/types.ts", "'watch-later' | 'dev';", "'watch-later' | 'shows' | 'dev';"),
 ("src/nav/lastView.ts", '"watch-later", "dev"];', '"watch-later", "shows", "dev"];'),
 ("src/App.tsx", "import { TodayView } from './components/TodayView';", "import { TodayView } from './components/TodayView';\nimport { ShowDrawersView } from './components/ShowDrawersView';"),
 ("src/App.tsx", "    case 'news-cube': return 'news-cube';\n", "    case 'news-cube': return 'news-cube';\n    case 'shows': return 'shows';\n"),
 ("src/App.tsx", "        {destination === 'today' && (", "        {destination === 'shows' && (\n          <div key=\"view-shows\" className=\"view-fade-in w-full\">\n            <ShowDrawersView onSelectProgram={handleEpgSelect} />\n          </div>\n        )}\n        {destination === 'today' && ("),
 ("src/components/Navigation.tsx", "  Activity,\n} from 'lucide-react';", "  Activity,\n  Clapperboard,\n} from 'lucide-react';"),
 ("src/components/Navigation.tsx", "  { id: 'watch-later', label: 'Watch Later', icon: Bookmark, description: 'Saved, and half-played, to finish later' },\n];",
  "  { id: 'watch-later', label: 'Watch Later', icon: Bookmark, description: 'Saved, and half-played, to finish later' },\n  { id: 'shows', label: 'Shows', icon: Clapperboard, description: 'Browse shows by channel' },\n];"),
 ("src/components/Navigation.tsx", "  PRIMARY_DESTINATIONS[1],\n  PRIMARY_DESTINATIONS[4],\n  PRIMARY_DESTINATIONS[6],\n];", "  PRIMARY_DESTINATIONS[1],\n  PRIMARY_DESTINATIONS[9],\n  PRIMARY_DESTINATIONS[4],\n  PRIMARY_DESTINATIONS[6],\n];"),
 ("src/components/Navigation.tsx", "  PRIMARY_DESTINATIONS[2], PRIMARY_DESTINATIONS[3], PRIMARY_DESTINATIONS[5], PRIMARY_DESTINATIONS[8],\n  { id: 'news-cube'", "  PRIMARY_DESTINATIONS[9], PRIMARY_DESTINATIONS[2], PRIMARY_DESTINATIONS[3], PRIMARY_DESTINATIONS[5], PRIMARY_DESTINATIONS[8],\n  { id: 'news-cube'"),
 ("server/classicNetworkPublication.ts", "import bakedMovies from '../src/data/classicMoviesPublication.json';", "import bakedMovies from '../src/data/classicMoviesPublication.json';\nimport bakedWesterns from '../src/data/classicWesternsPublication.json';"),
 ("server/classicNetworkPublication.ts", "const movies = createPublicationReader(bakedMovies);", "const movies = createPublicationReader(bakedMovies);\nconst westerns = createPublicationReader(bakedWesterns);"),
 ("server/classicNetworkPublication.ts", "export function classicMoviesChannel(nowMs = Date.now()): ScheduleChannel {",
  "export function classicWesternsChannel(nowMs = Date.now()): ScheduleChannel {\n  return networkChannel(westerns, 'classic-westerns', 'AJN Westerns', 'classic-tv', 'Classic TV', nowMs);\n}\nexport function classicMoviesChannel(nowMs = Date.now()): ScheduleChannel {"),
 ("guideRegistry.ts", "import { classicNetworkChannel, classicMoviesChannel } from './server/classicNetworkPublication';", "import { classicNetworkChannel, classicMoviesChannel, classicWesternsChannel } from './server/classicNetworkPublication';"),
 ("guideRegistry.ts", "    return [classicNetworkChannel(),...classic,...additions];", "    return [classicNetworkChannel(),classicWesternsChannel(),...classic,...additions];"),
 ("server/libraryIndex.ts", "if (ch.id === 'classic-network' || ch.id === 'classic-movies') continue;", "if (ch.id === 'classic-network' || ch.id === 'classic-movies' || ch.id === 'classic-westerns') continue;"),
 ("tools/compile-classic-network.mts", "const file = name === 'classic-network' ? 'src/data/classicNetworkPublication.json' : 'src/data/classicMoviesPublication.json';",
  "const files: Record<string, string> = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };\n  const file = files[name];\n  if (!file) throw new Error(`No publication file for ${name}`);"),
 ("tools/check-classic-network-publication.mjs", "const file = network === 'classic-network' ? 'src/data/classicNetworkPublication.json' : 'src/data/classicMoviesPublication.json';",
  "const files = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };\nconst file = files[network];"),
 ("tools/check-classic-network-publication.mjs", "if (!['classic-network', 'classic-movies'].includes(network)) throw new Error('Unknown network');", "if (!file) throw new Error('Unknown network');"),
]
bad = 0
for path, old, new in EDITS:
    if not os.path.exists(path): print("MISSING FILE", path); bad += 1; continue
    s = open(path, encoding="utf8").read()
    if new in s: print("already applied:", path, "|", old[:50].replace("\n", " ")); continue
    if s.count(old) != 1: print("CANNOT APPLY (found %d):" % s.count(old), path, "|", old[:60].replace("\n", " ")); bad += 1; continue
    open(path, "w", encoding="utf8", newline="").write(s.replace(old, new)); print("applied:", path, "|", old[:50].replace("\n", " "))
sys.exit(1 if bad else 0)
