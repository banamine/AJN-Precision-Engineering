# Shows + Westerns drop-in: exact edits for existing files
Apply each edit once. Every OLD text must match exactly once in the target file. New files in this zip are copied as-is at the same paths.
Fast path: from the repo root run `python apply-edits.py` (idempotent; reports anything it cannot apply).

## 1. `src/types.ts`

OLD:
```
'watch-later' | 'dev';
```
NEW:
```
'watch-later' | 'shows' | 'dev';
```

## 2. `src/nav/lastView.ts`

OLD:
```
"watch-later", "dev"];
```
NEW:
```
"watch-later", "shows", "dev"];
```

## 3. `src/App.tsx`

OLD:
```
import { TodayView } from './components/TodayView';
```
NEW:
```
import { TodayView } from './components/TodayView';
import { ShowDrawersView } from './components/ShowDrawersView';
```

## 4. `src/App.tsx`

OLD:
```
    case 'news-cube': return 'news-cube';

```
NEW:
```
    case 'news-cube': return 'news-cube';
    case 'shows': return 'shows';

```

## 5. `src/App.tsx`

OLD:
```
        {destination === 'today' && (
```
NEW:
```
        {destination === 'shows' && (
          <div key="view-shows" className="view-fade-in w-full">
            <ShowDrawersView onSelectProgram={handleEpgSelect} />
          </div>
        )}
        {destination === 'today' && (
```

## 6. `src/components/Navigation.tsx`

OLD:
```
  Activity,
} from 'lucide-react';
```
NEW:
```
  Activity,
  Clapperboard,
} from 'lucide-react';
```

## 7. `src/components/Navigation.tsx`

OLD:
```
  { id: 'watch-later', label: 'Watch Later', icon: Bookmark, description: 'Saved, and half-played, to finish later' },
];
```
NEW:
```
  { id: 'watch-later', label: 'Watch Later', icon: Bookmark, description: 'Saved, and half-played, to finish later' },
  { id: 'shows', label: 'Shows', icon: Clapperboard, description: 'Browse shows by channel' },
];
```

## 8. `src/components/Navigation.tsx`

OLD:
```
  PRIMARY_DESTINATIONS[1],
  PRIMARY_DESTINATIONS[4],
  PRIMARY_DESTINATIONS[6],
];
```
NEW:
```
  PRIMARY_DESTINATIONS[1],
  PRIMARY_DESTINATIONS[9],
  PRIMARY_DESTINATIONS[4],
  PRIMARY_DESTINATIONS[6],
];
```

## 9. `src/components/Navigation.tsx`

OLD:
```
  PRIMARY_DESTINATIONS[2], PRIMARY_DESTINATIONS[3], PRIMARY_DESTINATIONS[5], PRIMARY_DESTINATIONS[8],
  { id: 'news-cube'
```
NEW:
```
  PRIMARY_DESTINATIONS[9], PRIMARY_DESTINATIONS[2], PRIMARY_DESTINATIONS[3], PRIMARY_DESTINATIONS[5], PRIMARY_DESTINATIONS[8],
  { id: 'news-cube'
```

## 10. `server/classicNetworkPublication.ts`

OLD:
```
import bakedMovies from '../src/data/classicMoviesPublication.json';
```
NEW:
```
import bakedMovies from '../src/data/classicMoviesPublication.json';
import bakedWesterns from '../src/data/classicWesternsPublication.json';
```

## 11. `server/classicNetworkPublication.ts`

OLD:
```
const movies = createPublicationReader(bakedMovies);
```
NEW:
```
const movies = createPublicationReader(bakedMovies);
const westerns = createPublicationReader(bakedWesterns);
```

## 12. `server/classicNetworkPublication.ts`

OLD:
```
export function classicMoviesChannel(nowMs = Date.now()): ScheduleChannel {
```
NEW:
```
export function classicWesternsChannel(nowMs = Date.now()): ScheduleChannel {
  return networkChannel(westerns, 'classic-westerns', 'AJN Westerns', 'classic-tv', 'Classic TV', nowMs);
}
export function classicMoviesChannel(nowMs = Date.now()): ScheduleChannel {
```

## 13. `guideRegistry.ts`

OLD:
```
import { classicNetworkChannel, classicMoviesChannel } from './server/classicNetworkPublication';
```
NEW:
```
import { classicNetworkChannel, classicMoviesChannel, classicWesternsChannel } from './server/classicNetworkPublication';
```

## 14. `guideRegistry.ts`

OLD:
```
    return [classicNetworkChannel(),...classic,...additions];
```
NEW:
```
    return [classicNetworkChannel(),classicWesternsChannel(),...classic,...additions];
```

## 15. `server/libraryIndex.ts`

OLD:
```
if (ch.id === 'classic-network' || ch.id === 'classic-movies') continue;
```
NEW:
```
if (ch.id === 'classic-network' || ch.id === 'classic-movies' || ch.id === 'classic-westerns') continue;
```

## 16. `tools/compile-classic-network.mts`

OLD:
```
const file = name === 'classic-network' ? 'src/data/classicNetworkPublication.json' : 'src/data/classicMoviesPublication.json';
```
NEW:
```
const files: Record<string, string> = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };
  const file = files[name];
  if (!file) throw new Error(`No publication file for ${name}`);
```

## 17. `tools/check-classic-network-publication.mjs`

OLD:
```
const file = network === 'classic-network' ? 'src/data/classicNetworkPublication.json' : 'src/data/classicMoviesPublication.json';
```
NEW:
```
const files = { 'classic-network': 'src/data/classicNetworkPublication.json', 'classic-movies': 'src/data/classicMoviesPublication.json', 'classic-westerns': 'src/data/classicWesternsPublication.json' };
const file = files[network];
```

## 18. `tools/check-classic-network-publication.mjs`

OLD:
```
if (!['classic-network', 'classic-movies'].includes(network)) throw new Error('Unknown network');
```
NEW:
```
if (!file) throw new Error('Unknown network');
```

## Also
- Add `tools/.show-drawers-cache/` to `.gitignore`.
- `config/classic-networks.json` in this zip adds the `classic-westerns` network (full file; only that network was added).
