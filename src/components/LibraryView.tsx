import { useState, useMemo } from 'react';
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

interface LibraryViewProps {
  onPlayProgram: PlayProgramCallback;
}

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
  {
    id: 'lib-foxnews-vault',
    title: 'Fox News Special Report Broadcast Master',
    category: 'news',
    description: 'Archived evening news broadcast covering domestic policy, international headlines, and Capitol Hill press conferences.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '60 mins',
    format: 'TV News Slices (300s)',
    year: '2024',
    source: 'Internet Archive TV News',
    tags: ['Fox News', 'Newsroom', 'Broadcast'],
  },
  {
    id: 'lib-cnn-vault',
    title: 'CNN Situation Room Continuous Broadcast Reel',
    category: 'news',
    description: 'Continuous newsroom coverage and investigative reporting preserved in the Internet Archive TV News research collection.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '60 mins',
    format: 'TV News Slices (300s)',
    year: '2024',
    source: 'Internet Archive TV News',
    tags: ['CNN', 'Newsroom', 'Broadcast'],
  },
  {
    id: 'lib-msnbc-vault',
    title: 'MSNBC Prime Time News Wire Edition',
    category: 'news',
    description: 'Complete one-hour prime time broadcast with original teleprompter captions and anchor panel analysis.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '60 mins',
    format: 'TV News Slices (300s)',
    year: '2024',
    source: 'Internet Archive TV News',
    tags: ['MSNBC', 'Newsroom', 'Broadcast'],
  },
  {
    id: 'lib-radio-audio',
    title: 'Continuous Radio Mode Audio Stream',
    category: 'audio',
    description: 'Clean audio-only streaming channel routing through the single-owner M1 AudioBridge normalizer at broadcast compliance levels (-18 dBFS).',
    archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
    duration: '120 mins',
    format: 'Audio Stream',
    year: '2024',
    source: 'AJN Radio Hub',
    tags: ['Radio', 'Audio Only', 'Broadcast'],
  },
  {
    id: 'lib-silent-era',
    title: 'Silent Era Classic Newsreels & Motion Pictures',
    category: 'classics',
    description: 'Restored archival newsreels documenting historical events, transport innovations, and early 20th century cinema developments.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '35 mins',
    format: 'H.264 MP4',
    year: '1928',
    source: 'Prelinger Archives',
    tags: ['History', 'Silent Era', 'Newsreel'],
  },
  {
    id: 'lib-documentary-hour',
    title: 'Documentary Vault: Technological Innovations',
    category: 'documentary',
    description: 'Historical documentary exploring scientific advancements in satellite communications and global transmission networks.',
    archivePath: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4',
    duration: '50 mins',
    format: 'H.264 MP4',
    year: '1975',
    source: 'Academic Film Archive',
    tags: ['Documentary', 'Technology', 'Science'],
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

  const filteredItems = useMemo(() => {
    return LIBRARY_COLLECTION.filter((item) => {
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
  }, [selectedCategory, searchQuery]);

  return (
    <div className="space-y-8 pb-16">
      {/* ── Library Header & Search Bar ──────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FolderArchive className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">
              Media Archive Library
            </h1>
          </div>
          <p className="text-xs text-neutral-400">
            Consumer-facing curated broadcast archives, news vaults, and historical audio collections.
          </p>
        </div>

        {/* Live In-Library Filter Input */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
          <input
            type="text"
            id="library-filter-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter library items..."
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/90 pl-9 pr-3.5 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* ── Category Filter Pills ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/60 pb-4">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            id={`lib-cat-btn-${cat.id}`}
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
              selectedCategory === cat.id
                ? 'bg-emerald-500 text-neutral-950 font-semibold shadow-sm'
                : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            }`}
          >
            {cat.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">
          Showing {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* ── Library Items Grid ────────────────────────────────────────────── */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => {
            const isAudio = item.category === 'audio' || item.format.toLowerCase().includes('mp3');

            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 transition hover:border-neutral-700 hover:bg-neutral-900"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      {isAudio ? <FileAudio className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}
                      {item.format}
                    </span>
                    <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-300">
                      {item.year || 'Archive'}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-sm font-semibold text-neutral-100 group-hover:text-emerald-300 transition line-clamp-1">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-xs text-neutral-400 line-clamp-3 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.tags.map((tag, tIdx) => (
                      <span
                        key={tIdx}
                        className="rounded bg-neutral-950/80 px-2 py-0.5 text-[10px] text-neutral-400 border border-neutral-800/80"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-3.5 border-t border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{item.duration}</span>
                  </div>

                  <button
                    type="button"
                    id={`play-lib-item-${item.id}`}
                    onClick={() => onPlayProgram(item.archivePath, item.title, item.source)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Watch / Listen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-12 text-center space-y-2">
          <FolderArchive className="mx-auto h-8 w-8 text-neutral-600" />
          <h3 className="text-sm font-medium text-neutral-300">No items match your filter</h3>
          <p className="text-xs text-neutral-500">
            Try adjusting your search keywords or select a different category pill.
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setSearchQuery('');
            }}
            className="mt-3 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
}
