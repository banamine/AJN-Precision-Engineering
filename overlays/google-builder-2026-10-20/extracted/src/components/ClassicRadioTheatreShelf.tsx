import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PlayProgramCallback } from '../types';

type Genre = 'drama' | 'mystery-suspense' | 'sci-fi' | 'true-crime';
interface Show { id: string; displayName: string; measured: boolean }
interface GenreGroup { genre: Genre; shows: Show[] }
interface RegistryResponse { schemaVersion: number; genres: GenreGroup[]; totalShows: number }
interface Episode {
  showId: string;
  genre: Genre;
  identifier: string;
  title: string;
  creator: string | null;
  date: string | null;
  path: string;
  mediaType: 'audio';
  alternateGroup?: string;
}
interface SearchResponse {
  showId: string;
  genre: Genre;
  page: number;
  limit: number;
  total: number;
  unavailableCount: number;
  results: Episode[];
}

export function classicRadioEmptyMessage(result: Pick<SearchResponse, 'total' | 'results'>): string | null {
  if (result.results.length > 0) return null;
  return result.total === 0
    ? 'No public episodes found for this show'
    : 'Archive returned matches, but no public playable audio file was available on this page.';
}

const GENRE_LABEL: Record<Genre, string> = {
  drama: 'Drama',
  'mystery-suspense': 'Mystery & Suspense',
  'sci-fi': 'Science Fiction',
  'true-crime': 'True Story & True Crime',
};

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body && typeof body.reason === 'string' ? body.reason : body?.error;
    throw new Error(reason || `Request failed (${response.status})`);
  }
  return body as T;
}

export function ClassicRadioTheatreShelf({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const [catalog, setCatalog] = useState<RegistryResponse | null>(null);
  const [selected, setSelected] = useState<Show | null>(null);
  const [typedQuery, setTypedQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/classic-radio/shows')
      .then((response) => jsonResponse<RegistryResponse>(response))
      .then((value) => { if (alive) setCatalog(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Catalogue unavailable'); })
      .finally(() => { if (alive) setLoadingCatalog(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const params = new URLSearchParams({ show: selected.id, genre: catalog?.genres.find((g) => g.shows.some((s) => s.id === selected.id))?.genre ?? '', q: submittedQuery, page: '1', limit: '12' });
    setLoadingResults(true);
    setError(null);
    setResult(null);
    fetch(`/api/classic-radio/search?${params.toString()}`)
      .then((response) => jsonResponse<SearchResponse>(response))
      .then((value) => { if (alive) setResult(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Search unavailable'); })
      .finally(() => { if (alive) setLoadingResults(false); });
    return () => { alive = false; };
  }, [selected, submittedQuery, catalog]);

  const groups = useMemo(() => catalog?.genres ?? [], [catalog]);
  const emptyMessage = result ? classicRadioEmptyMessage(result) : null;
  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(typedQuery.trim());
  }

  return (
    <section aria-labelledby="classic-radio-heading" className="space-y-5 rounded-2xl border border-amber-900/40 bg-neutral-950/70 p-4">
      <header>
        <h2 id="classic-radio-heading" className="text-lg font-semibold text-neutral-100">Classic Radio Theatre</h2>
        <p className="mt-1 text-sm text-neutral-400">Search public audio by show, episode title, or full date.</p>
      </header>

      {loadingCatalog && <p className="text-sm text-neutral-400" role="status">Loading show catalogue…</p>}
      {error && !selected && <p className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300" role="alert">Catalogue unavailable: {error}</p>}

      {groups.map((group) => (
        <div key={group.genre} className="space-y-2">
          <h3 className="text-sm font-semibold text-amber-200">{GENRE_LABEL[group.genre]}</h3>
          <div className="flex flex-wrap gap-2">
            {group.shows.map((show) => (
              <button
                key={show.id}
                type="button"
                aria-pressed={selected?.id === show.id}
                onClick={() => { setSelected(show); setSubmittedQuery(''); setTypedQuery(''); }}
                className={`rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  selected?.id === show.id
                    ? 'border-amber-300 bg-amber-300/15 text-amber-100'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-amber-500/70'
                }`}
              >
                {show.displayName}
              </button>
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <div className="space-y-3 border-t border-neutral-800 pt-4">
          <h3 className="text-base font-semibold text-neutral-100">{selected.displayName}</h3>
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="classic-radio-query">Episode title or date</label>
            <input
              id="classic-radio-query"
              value={typedQuery}
              onChange={(event) => setTypedQuery(event.target.value)}
              placeholder="Episode title or YYYY-MM-DD"
              maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
            <button type="submit" className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-200">
              Search episodes
            </button>
          </form>

          {loadingResults && <p role="status" className="text-sm text-neutral-400">Searching Archive audio…</p>}
          {error && <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">Search unavailable: {error}</p>}
          {!loadingResults && !error && emptyMessage && (
            <p className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 text-sm text-neutral-300">{emptyMessage}</p>
          )}
          {result && result.results.length > 0 && (
            <ul className="space-y-2">
              {result.results.map((episode) => (
                <li key={episode.identifier}>
                  <button
                    type="button"
                    onClick={() => onPlayProgram(
                      episode.path,
                      episode.title,
                      episode.creator ?? episode.date ?? selected.displayName,
                      'audio',
                      `classic-radio-${episode.showId}`,
                      'audio-podcasts',
                      episode.identifier,
                      episode.identifier,
                      episode.identifier,
                    )}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-3 text-left hover:border-amber-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-100">{episode.title}</span>
                      <span className="block truncate text-xs text-neutral-400">
                        {[episode.creator, episode.date].filter(Boolean).join(' · ') || 'Creator/date not listed'}
                        {episode.alternateGroup ? ' · Alternate upload' : ''}
                      </span>
                    </span>
                    <span aria-hidden="true" className="shrink-0 text-amber-200">▶</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result && result.unavailableCount > 0 && (
            <p className="text-xs text-neutral-500">{result.unavailableCount} Archive match(es) had no public playable audio file and were skipped.</p>
          )}
        </div>
      )}
    </section>
  );
}
