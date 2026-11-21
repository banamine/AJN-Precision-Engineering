// Shows detail panel (Dusk skin only): "Why it plays" chips, season tabs and the episode list for one open show.
// Replaces the plain episode list inside ShowDrawersView's open drawer; the Current skin keeps the original list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { ALL_SEASONS, epCode, filterEpisodes, seasonsOf, whyItPlays, type EpisodeFacts, type ShowFacts } from '../shows/showDetail';

interface Props {
  show: ShowFacts & { id: string; title: string };
  episodes: EpisodeFacts[] | null;
  loadError: string | null;
  continuePath: string | null;
  onPlay: (ep: EpisodeFacts) => void;
  onPlayNext: () => void;
}
const PAGE = 200;

export function ShowDetailPanel({ show, episodes, loadError, continuePath, onPlay, onPlayNext }: Props) {
  const [season, setSeason] = useState<number | typeof ALL_SEASONS>(ALL_SEASONS);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const seasons = useMemo(() => (episodes ? seasonsOf(episodes) : []), [episodes]);
  const chips = useMemo(() => whyItPlays(show, episodes), [show, episodes]);
  const matches = useMemo(() => (episodes ? filterEpisodes(episodes, season, query) : []), [episodes, season, query]);
  useEffect(() => { setLimit(PAGE); }, [season, query]);

  const tabs: Array<number | typeof ALL_SEASONS> = [ALL_SEASONS, ...seasons.map((s) => s.season)];
  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const i = (next + tabs.length) % tabs.length;
    setSeason(tabs[i]);
    tabRefs.current[i]?.focus();
  };

  return (
    <div className="ajn-detail" data-testid="show-detail">
      <div className="ajn-detail__head">
        <ul className="ajn-detail__chips" aria-label={`Why ${show.title} plays`} data-testid="why-it-plays">
          {chips.map((c) => <li key={c.id} className={`ajn-detail__chip ajn-detail__chip--${c.tone}`} title={`Source: ${c.source}`} data-chip={c.id}>{c.label}</li>)}
        </ul>
        <button type="button" onClick={onPlayNext} className="ajn-detail__play" aria-label={`${continuePath ? 'Next episode' : 'Play'} of ${show.title}`}>
          <Play size={14} aria-hidden="true" />{continuePath ? 'Next episode' : 'Play'}
        </button>
      </div>

      {loadError && <p role="alert" className="ajn-detail__note">Episode list unavailable: {loadError}</p>}
      {!loadError && !episodes && <p className="ajn-detail__note">Loading episodes…</p>}

      {episodes && seasons.length > 0 && (
        <div role="tablist" aria-label="Seasons" className="ajn-detail__tabs" data-testid="season-tabs">
          {tabs.map((t, i) => (
            <button key={String(t)} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`season-tab-${show.id}-${t}`}
              aria-selected={season === t} tabIndex={season === t ? 0 : -1} aria-controls={`season-panel-${show.id}`}
              onClick={() => setSeason(t)} onKeyDown={(e) => onTabKey(e, i)} className="ajn-detail__tab">
              {t === ALL_SEASONS ? `All (${episodes.length})` : `Season ${t} (${seasons.find((s) => s.season === t)?.count ?? 0})`}
            </button>
          ))}
        </div>
      )}

      {episodes && episodes.length > 60 && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${episodes.length} episodes`}
          aria-label={`Filter episodes of ${show.title}`} className="ajn-detail__filter" />
      )}

      {episodes && (
        <div role={seasons.length ? 'tabpanel' : undefined} id={`season-panel-${show.id}`} aria-labelledby={seasons.length ? `season-tab-${show.id}-${season}` : undefined}>
          <ol className="ajn-detail__list">
            {matches.slice(0, limit).map((ep) => (
              <li key={ep.p}>
                <button type="button" onClick={() => onPlay(ep)} className={`ajn-detail__ep${continuePath === ep.p ? ' is-current' : ''}`}>
                  <span className="ajn-detail__ep-title">{epCode(ep) ? `${epCode(ep)} · ` : ''}{ep.t}</span>
                  <span className="ajn-detail__ep-len">{ep.d > 0 ? `${Math.round(ep.d / 60)} min` : ''}</span>
                </button>
              </li>
            ))}
          </ol>
          {matches.length === 0 && <p className="ajn-detail__note">No episodes match.</p>}
          {matches.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + 300)} className="ajn-detail__more">Show more ({matches.length - limit} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
