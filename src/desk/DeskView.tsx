/* Declassified Desk: story cards and scan cards from real government scans on Archive.org.
 * No links to Archive.org anywhere on this page: only image addresses are used. */
import { useMemo, useState } from 'react';
import { useDesk, type DeskItem } from './useDesk';
import { StoryWindow, Pill } from './StoryWindow';
import { isSaved, loadSaved, saveSaved, toggleSaved } from './savedStories';
import './desk.css';

type BeatId = 'all' | string;

function Media({ item, label, big }: { item: DeskItem; label: string; big?: boolean }) {
  const [bad, setBad] = useState(false);
  return (
    <div className={`dk-media${big ? ' dk-media-big' : ''}`}>
      {bad ? <div className="dk-nothumb" role="img" aria-label="No page image">No page image</div>
        : <img src={big ? item.pageUrl : item.thumbUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />}
      <span className="dk-stamp">{label}</span>
      <span className="dk-year">{item.year ?? '—'}</span>
    </div>
  );
}

function Card({ item, label, lead, onOpen }: { item: DeskItem; label: string; lead?: boolean; onOpen: (i: DeskItem, btn: HTMLElement) => void }) {
  return (
    <article className={`dk-card dk-${item.cardType}${lead ? ' dk-lead' : ''}`} data-testid="desk-card" data-card-type={item.cardType}>
      <button type="button" className="dk-open" onClick={(e) => onOpen(item, e.currentTarget)} aria-label={`Open ${item.headline}`}>
        <Media item={item} label={label} big={lead} />
        <div className="dk-body">
          <h3 className="dk-headline">{item.headline}</h3>
          {item.cardType === 'story' ? (
            <>
              <span className="dk-kicker">Lead from the document</span>
              <p className="dk-leadtext">{item.lead}</p>
            </>
          ) : <p className="dk-note">Scanned page. The text is too rough to read as a story, so the original is shown. Open it for the full page.</p>}
          <div className="dk-meta">
            <span className="dk-source">{item.source}</span>
            {item.pages ? <span>{item.pages} {item.pages === 1 ? 'page' : 'pages'}</span> : null}
            <Pill item={item} />
          </div>
        </div>
      </button>
    </article>
  );
}

export default function DeskView() {
  const desk = useDesk();
  const [beat, setBeat] = useState<BeatId>('all');
  const [open, setOpen] = useState<{ item: DeskItem; btn: HTMLElement | null } | null>(null);
  const feed = desk.phase === 'ready' ? desk.feed : null;
  const [saved, setSaved] = useState<DeskItem[]>(() => loadSaved());
  const toggle = (item: DeskItem) => setSaved((list) => { const next = toggleSaved(list, item); saveSaved(next); return next; });
  const items = useMemo(() => (beat === 'saved' ? saved : feed ? feed.items.filter((i) => beat === 'all' || i.beat === beat) : []), [feed, beat, saved]);
  const activeBeat = beat === 'saved' ? undefined : feed?.beats.find((b) => b.id === beat);

  return (
    <section className="dk-root" aria-label="Declassified Desk" data-testid="desk-view">
      <header className="dk-header">
        <h1>Declassified Desk</h1>
        {feed ? (
          <div className="dk-chips" role="tablist" aria-label="Beats">
            <button role="tab" aria-selected={beat === 'all'} onClick={() => setBeat('all')}>All <small>{feed.count}</small></button>
            <button role="tab" aria-selected={beat === 'saved'} onClick={() => setBeat('saved')} data-testid="desk-saved-chip">Saved <small>{saved.length}</small></button>
            {feed.beats.map((b) => (
              <button key={b.id} role="tab" aria-selected={beat === b.id} className={b.enabled ? '' : 'dk-off'} onClick={() => setBeat(b.id)}>
                {b.label} <small>{b.enabled ? b.count : '–'}</small>
              </button>
            ))}
          </div>
        ) : null}
        {feed ? <span className={`dk-updated${feed.snapshot?.stale ? ' dk-stale' : ''}`} data-testid="desk-updated">
          {feed.snapshot?.stale ? `Saved ${feed.snapshot.ageDays} days ago, refresh is overdue` : `Updated ${new Date(feed.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        </span> : null}
        <details className="dk-info">
          <summary aria-label="How cards are chosen">ⓘ How cards are chosen</summary>
          <p>English-language items only. A story card needs a mean OCR confidence of 75% or more; anything rougher is a scan card with the page image first. Leads are copied word for word from the document, never rewritten.</p>
        </details>
      </header>

      {desk.phase === 'loading' || desk.phase === 'building' ? <p role="status" className="dk-state">{desk.phase === 'building' ? 'Reading today’s documents from the library… this can take a minute.' : 'Loading…'}</p> : null}
      {desk.phase === 'error' ? (
        <div role="alert" className="dk-state dk-error"><p>{desk.message}</p><button type="button" onClick={desk.retry}>Try again</button></div>
      ) : null}
      {feed && activeBeat && !activeBeat.enabled ? <div className="dk-empty">Not loaded yet. This beat has no documents on the desk.</div> : null}
      {feed && !(activeBeat && !activeBeat.enabled) && items.length === 0 ? <div className="dk-empty">{beat === 'saved' ? 'No saved stories yet. Open a story and press Save.' : 'No documents passed the checks for this beat today.'}</div> : null}
      {items.length > 0 ? (
        <div className="dk-grid">
          {items.map((it, i) => <Card key={it.id} item={it} label={feed?.beats.find((b) => b.id === it.beat)?.label ?? ''} lead={i === 0 && beat === 'all' && it.cardType === 'story'} onOpen={(item, btn) => setOpen({ item, btn })} />)}
        </div>
      ) : null}
      <footer className="dk-foot">Government documents scanned and published in the library. OCR text is machine-read and can contain errors.</footer>
      {open ? <StoryWindow item={open.item} returnFocus={open.btn} onClose={() => setOpen(null)} saved={isSaved(saved, open.item.id)} onToggleSave={() => toggle(open.item)} /> : null}
    </section>
  );
}
