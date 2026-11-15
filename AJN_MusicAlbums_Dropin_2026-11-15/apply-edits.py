# Run from the repo root: python apply-edits.py   (idempotent; works with or without the ExtraLibrary drop-in applied)
import pathlib,sys
def edit(path,edits,marker):
    p=pathlib.Path(path); s=p.read_text(encoding='utf-8')
    if marker in s: print('already applied:',path); return
    for a,b in edits: assert s.count(a)==1,'anchor not found / not unique in '+path+': stop: '+a[:60]
    for a,b in edits: s=s.replace(a,b)
    p.write_text(s,encoding='utf-8'); print('applied',len(edits),'edits to',path)
edit('server/libraryIndex.ts',[
("import { catalogRecords, isCatalogRecord } from './library/catalogRecords';",
 "import { catalogRecords, isCatalogRecord } from './library/catalogRecords';\nimport { musicAlbumRecords } from './library/musicAlbumRecords';"),
("  { id: 'podcast-episodes', label: 'Podcast Episodes', mediaType: 'audio' },\n];",
 "  { id: 'podcast-episodes', label: 'Podcast Episodes', mediaType: 'audio' },\n  { id: 'music-albums', label: 'Music Albums (VA)', mediaType: 'audio' },\n];"),
("export function setLibraryIndexForTests(items: IndexRecord[] | null) {",
 "let musicAlbumsOn = true; // tests that install their own fixture turn the shipped album records off\nexport function setMusicAlbumsForTests(on: boolean) { musicAlbumsOn = on; }\nexport function setLibraryIndexForTests(items: IndexRecord[] | null) { musicAlbumsOn = false;"),
("...catalogRecords()",
 "...catalogRecords(), ...(musicAlbumsOn ? musicAlbumRecords() : [])"),
],'musicAlbumRecords')
edit('server/library/catalogRecords.ts',[("['concerts', 'fm-broadcasts', 'podcast-episodes'] as const","['concerts', 'fm-broadcasts', 'podcast-episodes', 'music-albums'] as const")],"'music-albums'")
edit('src/components/LibraryView.tsx',[("c === 'concerts' || c === 'fm-broadcasts');","c === 'concerts' || c === 'fm-broadcasts' || c === 'music-albums');")],"'music-albums'")
# ---- Archive Music deck: genre pools (same setup as Live Concerts) ----
edit('src/components/ScheduleDeck.tsx',[
("import { buildMusicPools, loadConcertPools, loadFmPools, loadPodcastPools } from '../utils/scheduleCatalog';",
 "import { loadConcertPools, loadFmPools, loadPodcastPools } from '../utils/scheduleCatalog';\nimport { loadMusicPools } from '../utils/musicGenrePools';"),
("  const musicPools = useMemo(() => buildMusicPools(), []);\n", ""),
("if (bank === 'music' || loaded[bank]) return;", "if (loaded[bank]) return;"),
("(bank === 'concerts' ? loadConcertPools() : bank === 'podcasts'", "(bank === 'concerts' ? loadConcertPools() : bank === 'music' ? loadMusicPools() : bank === 'podcasts'"),
("bank === 'music' ? musicPools : loaded[bank] ?? null;", "loaded[bank] ?? null;"),
("(bank === 'music' ? pools.find((p) => p.id === nowPlaying?.channelId)?.id ?? pools.find((p) => p.items[0]?.tracks.every((t) => t.durationSeconds))?.id : undefined)",
 "(bank === 'music' ? pools.find((p) => p.id === nowPlaying?.channelId)?.id : undefined)"),
("pools.slice(0, GENRE_KEYS_MAX).map", "pools.slice(0, bank === 'music' ? 24 : GENRE_KEYS_MAX).map"),
],'loadMusicPools')
