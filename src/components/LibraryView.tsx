import { useState, useMemo, useEffect } from 'react';
import {
  FolderArchive,
  Search,
  Play,
  Filter,
  Tv,
  Radio,
  FileVideo,
  FileAudio,
  Sparkles,
  Tag,
  Clock,
  Layers,
} from 'lucide-react';
import { LibraryItem, PlayProgramCallback } from '../types';
import { getArchiveNews, getArchiveNewsSources, playUrl, ArchivePlayableItem } from '../services/ArchiveNewsClient';

interface LibraryViewProps {
  onPlayProgram: PlayProgramCallback;
}

const SHERLOCK_HOLMES_FOREWORD = 'https://archive.org/download/sherlock-holmes-the-adventures-of-sherlock-holmes/Chapter%2000.2%20-%20Foreword.mp3';

const LIBRARY_COLLECTION: LibraryItem[] = [
  {
    id: 'lib-apollo11',
    title: 'NASA Apollo 11 Lunar Landing Audio Highlights',
    category: 'science',
    description: 'Direct audio recordings of communications between Mission Control in Houston and Apollo 11 astronauts Neil Armstrong and Buzz Aldrin during the first lunar landing.',
    archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
    duration: '45 mins',
    format: 'MP3 Audio (64kbps)',
    year: '1969',
    source: 'NASA Public Audio Archives',
    featured: true,
    tags: ['NASA', 'Apollo 11', 'Spaceflight', 'Radio'],
  },
  {
    id: 'lib-sherlock-adventures',
    title: 'Adventures of Sherlock Holmes Audio Vault',
    category: 'audio',
    description: 'Archive.org audiobook collection for The Adventures of Sherlock Holmes. Starts with the verified MP3 Foreword asset and can be expanded with the collection chapters.',
    archivePath: SHERLOCK_HOLMES_FOREWORD,
    duration: 'Archive collection',
    format: 'MP3 Audio',
    year: 'Archive',
    source: 'Internet Archive — sherlock-holmes-the-adventures-of-sherlock-holmes',
    featured: true,
    tags: ['Sherlock Holmes', 'Audiobook', 'Audio', 'Archive.org'],
  },
  {
    id: 'lib-bigbuck',
    title: 'Big Buck Bunny High-Definition Master',
    category: 'classics',
    description: 'Open source computer animated short film by the Blender Institute, widely used as an open-standard video playback calibration benchmark.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '10 mins',
    format: 'H.264 / AAC MP4',
    year: '2008',
    source: 'Blender Foundation',
    featured: true,
    tags: ['Cinema', 'Animation', 'H.264', 'Benchmark'],
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All Media' },
  { id: 'news', label: 'Newsroom Feeds' },
  { id: 'science', label: 'Aerospace & Science' },
  { id: 'classics', label: 'Classic Cinema' },
  { id: 'audio', label: 'Audio & Radio' },
  { id: 'documentary', label: 'Documentaries' },
];

export function LibraryView({ onPlayProgram }: LibraryViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [archiveNewsItems, setArchiveNewsItems] = useState<ArchivePlayableItem[]>([]);
  const [archiveNewsStatus, setArchiveNewsStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function loadArchiveNews() {
      try {
        const sources = await getArchiveNewsSources();
        const results = await Promise.all(
          sources.map((source) => getArchiveNews(source.id, 1, 4))
        );
        if (cancelled) return;
        setArchiveNewsItems(results.flatMap((result) => result.playable));
        setArchiveNewsStatus('ready');
      } catch (error) {
        console.error('[AJN Library] Archive news discovery failed', error);
        if (!cancelled) setArchiveNewsStatus('error');
      }
    }

    loadArchiveNews();
    return () => {
      cancelled = true;
    };
  }, []);

  const libraryItems = useMemo<LibraryItem[]>(() => [
    ...LIBRARY_COLLECTION,
    ...archiveNewsItems.map((item) => ({
      id: `archive-news-${item.sourceId}-${item.identifier}`,
      title: item.title,
      category: 'news' as const,
      description: `Verified Archive.org MP4 derivative: ${item.filename}`,
      archivePath: playUrl(item),
      duration: 'Archive video',
      format: 'Verified MP4',
      year: item.timestamp ? item.timestamp.slice(0, 4) : 'Archive',
      source: `Internet Archive — ${item.sourceId.toUpperCase()}`,
      tags: ['Archive.org', item.sourceId.toUpperCase(), 'News'],
    })),
  ], [archiveNewsItems]);

  const filteredItems = useMemo(() => {
    return libraryItems.filter((item) => {
      const matchesCat = selectedCategory === 'all' || item.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.source.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [libraryItems, selectedCategory, searchQuery]);

  return (
    <div className="space-y-8 pb-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FolderArchive className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">Media Archive Library</h1>
          </div>
          <p className="text-xs text-neutral-400">Consumer-facing curated broadcast archives, news vaults, and historical audio collections.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
          <input type="text" id="library-filter-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter library items..." className="w-full rounded-xl border border-neutral-800 bg-neutral-900/90 pl-9 pr-3.5 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-400">
        <span className="font-medium text-neutral-200">Archive News:</span>{' '}
        {archiveNewsStatus === 'loading' && 'resolving verified MP4 derivatives…'}
        {archiveNewsStatus === 'ready' && `${archiveNewsItems.length} verified items loaded from the Archive News API.`}
        {archiveNewsStatus === 'error' && 'discovery failed; no placeholder news assets were substituted.'}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/60 pb-4">
        {CATEGORIES.map((cat) => (
          <button key={cat.id} id={`lib-cat-btn-${cat.id}`} type="button" onClick={() => setSelectedCategory(cat.id)} className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${selectedCategory === cat.id ? 'bg-emerald-500 text-neutral-950 font-semibold shadow-sm' : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'}`}>
            {cat.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">Showing {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}</span>
      </div>

      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => {
            const isAudio = item.category === 'audio' || item.format.toLowerCase().includes('mp3');
            return (
              <div key={item.id} className="group relative flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 transition hover:border-neutral-700 hover:bg-neutral-900">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">{isAudio ? <FileAudio className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}{item.format}</span>
                    <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-300">{item.year || 'Archive'}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-100 group-hover:text-emerald-300 transition line-clamp-1">{item.title}</h2>
                    <p className="mt-1 text-xs text-neutral-400 line-clamp-3 leading-relaxed">{item.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">{item.tags.map((tag, tIdx) => <span key={tIdx} className="rounded bg-neutral-950/80 px-2 py-0.5 text-[10px] text-neutral-400 border border-neutral-800/80">#{tag}</span>)}</div>
                </div>
                <div className="mt-5 pt-3.5 border-t border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-500"><Clock className="h-3.5 w-3.5" /><span>{item.duration}</span></div>
                  <button type="button" id={`play-lib-item-${item.id}`} onClick={() => onPlayProgram(item.archivePath, item.title, item.source)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"><Play className="h-3 w-3 fill-current" />Watch / Listen</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-12 text-center space-y-2">
          <FolderArchive className="mx-auto h-8 w-8 text-neutral-600" />
          <h3 className="text-sm font-medium text-neutral-300">No items match your filter</h3>
          <p className="text-xs text-neutral-500">Try adjusting your search keywords or select a different category pill.</p>
          <button type="button" onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }} className="mt-3 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700">Clear Filters</button>
        </div>
      )}
    </div>
  );
}
