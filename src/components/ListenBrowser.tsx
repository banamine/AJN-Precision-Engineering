import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Play, Search, X } from 'lucide-react';
import { filterListenItems, listenGenres, type ListenItem } from '../utils/listenCatalog';
import { AUDIO_SLOTS, saveAudioPreset, useAudioPresets, type AudioBank } from '../utils/audioPresets';

type Tab = 'all' | AudioBank;
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'music', label: 'Archive Music' }, { id: 'concerts', label: 'Live Concerts' }, { id: 'podcasts', label: 'Podcasts' },
];
const MAX_ROWS = 40;

interface Props {
  music: readonly ListenItem[];
  concerts: readonly ListenItem[] | null;
  podcasts: readonly ListenItem[];
  concertsError?: string | null;
  loadConcerts: () => void;
  spokenLoaded?: boolean;
  spokenError?: string | null;
  feedsDown?: readonly { name: string; reason: string }[];
  loadSpoken?: () => void;
  playingProgramId?: string;
  onPlay: (item: ListenItem) => void;
  /** First file of an item, as stored on a key. */
  presetFor: (item: ListenItem) => { itemId: string; title: string; subtitle: string; src: string; channelId: string; guideId: string; programId: string } | null;
}

/** Search + genre pills over every playable catalog, with one-tap "save to key 1–5" on each result. */
export function ListenBrowser({ music, concerts, podcasts, concertsError, loadConcerts, spokenLoaded = true, spokenError = null, feedsDown = [], loadSpoken, playingProgramId, onPlay, presetFor }: Props): ReactElement {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [note, setNote] = useState('');
  const banks = useAudioPresets();
  useEffect(() => { if (tab === 'all' || tab === 'concerts') loadConcerts(); }, [tab, loadConcerts]);
  useEffect(() => { if (tab === 'all' || tab === 'podcasts') loadSpoken?.(); }, [tab, loadSpoken]);

  const pool = useMemo<readonly ListenItem[]>(() => {
    if (tab === 'music') return music;
    if (tab === 'concerts') return concerts ?? [];
    if (tab === 'podcasts') return podcasts;
    return [...music, ...podcasts, ...(concerts ?? [])];
  }, [tab, music, concerts, podcasts]);
  const genres = useMemo(() => listenGenres(pool), [pool]);
  const results = useMemo(() => filterListenItems(pool, query, genre), [pool, query, genre]);
  const waitingForConcerts = (tab === 'concerts' || tab === 'all') && !concerts && !concertsError;

  const pick = (next: Tab): void => { setTab(next); setGenre(''); if (next === 'concerts' || next === 'all') loadConcerts(); if (next === 'podcasts' || next === 'all') loadSpoken?.(); };
  const save = (item: ListenItem, slot: number): void => {
    const p = presetFor(item);
    if (!p) { setNote(`${item.title} has no playable files.`); return; }
    const res = saveAudioPreset(item.bank, slot, p);
    setNote(res.saved ? `Saved "${item.title}" to ${TABS.find((t) => t.id === item.bank)?.label} key ${slot}.` : 'Could not save that preset.');
  };

  return (
    <section className="ajr-section" id="ajr-find" aria-label="Find music, concerts and podcasts" data-testid="listen-browser">
      <div className="ajr-heading"><div><div className="ajr-label">ARCHIVE MUSIC · LIVE CONCERTS · PODCASTS</div><h2>Find &amp; <em>save.</em></h2></div><span className="ajr-aside">PLAY IT, OR PUT IT ON A KEY OF THE DECK.</span></div>
      <div className="ajr-chips" role="group" aria-label="Source">
        {TABS.map((t) => <button key={t.id} type="button" data-testid={`listen-tab-${t.id}`} aria-pressed={tab === t.id} className={`ajr-chip${tab === t.id ? ' selected' : ''}`} onClick={() => pick(t.id)}>{t.label.toUpperCase()}</button>)}
      </div>
      <label className="ajr-search">
        <Search size={15} aria-hidden="true" />
        <input data-testid="listen-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search artist, show, concert…" aria-label="Search music, concerts and podcasts" />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
      </label>
      {genres.length > 1 && (
        <div className="ajr-chips" role="group" aria-label="Genre">
          <button type="button" className={`ajr-chip${genre === '' ? ' selected' : ''}`} aria-pressed={genre === ''} onClick={() => setGenre('')}>ALL GENRES</button>
          {genres.slice(0, 16).map((g) => <button key={g} type="button" data-testid="listen-genre" className={`ajr-chip${genre === g ? ' selected' : ''}`} aria-pressed={genre === g} onClick={() => setGenre(genre === g ? '' : g)}>{g.toUpperCase()}</button>)}
        </div>
      )}
      <p className="ajr-status" role="status" aria-live="polite" data-testid="listen-count">
        {waitingForConcerts ? 'Loading concerts… ' : ''}{(tab === 'podcasts' || tab === 'all') && !spokenLoaded && !spokenError ? 'Loading podcasts… ' : ''}{spokenError && (tab === 'podcasts' || tab === 'all') ? `Podcast list unavailable: ${spokenError}. ` : ''}{feedsDown.length > 0 && (tab === 'podcasts' || tab === 'all') ? `${feedsDown.length} podcast feed${feedsDown.length === 1 ? '' : 's'} could not be read by the server (${feedsDown.slice(0, 3).map((f) => f.name).join(', ')}${feedsDown.length > 3 ? '…' : ''}). ` : ''}{concertsError && (tab === 'concerts' || tab === 'all') ? `Concerts unavailable: ${concertsError}. ` : ''}{results.length} result{results.length === 1 ? '' : 's'}{results.length > MAX_ROWS ? ` · showing the first ${MAX_ROWS}, search to narrow` : ''}{note ? ` · ${note}` : ''}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Results">
        {results.slice(0, MAX_ROWS).map((item) => {
          const active = Boolean(playingProgramId?.startsWith(`${item.id}::`));
          const saved = AUDIO_SLOTS.filter((n) => banks[item.bank][n]?.itemId === item.id);
          return (
            <li key={item.id} data-testid="listen-row" className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${active ? 'border-[#E06D3B] bg-[#E06D3B]/10' : 'border-white/10 bg-white/[0.03]'}`}>
              <button type="button" aria-label={`Play ${item.title}`} data-testid="listen-play" onClick={() => onPlay(item)} className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-[#E06D3B] text-[#0F1117] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><Play size={16} fill="currentColor" /></button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                <div className="truncate text-xs text-neutral-400">{item.subtitle}{saved.length ? ` · on key ${saved.join(', ')}` : ''}</div>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label={`Save ${item.title} to a key`}>
                <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Save to key</span>
                {AUDIO_SLOTS.map((n) => <button key={n} type="button" data-testid={`listen-save-${n}`} aria-label={`Save to ${item.bank} key ${n}`} onClick={() => save(item, n)} className="h-8 w-8 cursor-pointer rounded-md border border-white/20 text-xs font-bold text-neutral-200 hover:border-[#E06D3B] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E06D3B]">{n}</button>)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
