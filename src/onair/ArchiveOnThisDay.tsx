/* "From the Library · On This Day" panel body. One entry at a time: Declassified Desk stories (news-article cards, click to open the story window),
 * real Archive items from the library, and the library recording. Full text wrapped, never ellipsised by line.
 * Library items are display only: no links leave the page. */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArchiveItem, OnThisDay } from './useOnAirData';
import type { RankedStory } from '../desk/onThisDay';
import { dateLine } from '../desk/onThisDay';
import { buildEntries, pickEntry, ITEM_DWELL_MS, NEWS_PER_SLIDE, NEWS_MAX_SLIDES, diverseHeadlines, dwellOf } from './archiveEntries';
import { AJN_PLAYOUT as E } from './engine.js';
import type { Headline } from './useOnAirData';
import type { DeskItem } from '../desk/useDesk';

export const ARCHIVE_DWELL_MS = ITEM_DWELL_MS;
const KIND: Record<ArchiveItem['mediatype'], string> = { texts: 'READ', audio: 'LISTEN', movies: 'WATCH' };

function sourceColor(source: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) % 1000;
  const hue = (hash % 8) * (360 / 8);
  return {
    bg: `hsla(${hue}, 70%, 45%, 0.25)`,
    fg: `hsl(${hue}, 85%, 75%)`,
  };
}

export default function ArchiveOnThisDay({ items, rush, stories = [], headlines = [], nowMs, compact, onOpenStory, big, captionHost }: { headlines?: Headline[]; big?: boolean; captionHost?: HTMLElement | null; items: ArchiveItem[]; rush: OnThisDay | null; stories?: RankedStory[]; nowMs: number; compact: boolean; onOpenStory?: (item: DeskItem, dateLabel: string, el: HTMLElement) => void }) {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  // Big panel with real Declassified Desk stories: the stories run on their own (no scanned-page slides between them).
  const storiesOnly = !!big && stories.length > 0;
  // Current news (real headlines only; none means no news slides) runs in the big panel between the stories.
  const newsPool = useMemo(() => (big ? diverseHeadlines(headlines, NEWS_PER_SLIDE * NEWS_MAX_SLIDES) : []), [big, headlines]);
  const newsSlides = Math.min(NEWS_MAX_SLIDES, Math.ceil(newsPool.length / NEWS_PER_SLIDE));
  const entries = buildEntries(stories.length, stories.filter((s) => s.near).length, storiesOnly ? 0 : items.length, storiesOnly ? false : !!rush, newsSlides);
  const pick = pickEntry(entries, nowMs);
  if (!pick) return null;
  const { entry, n, total } = pick;
  const dwell = dwellOf(entry);
  const counter = total > 1 ? <span className="arch-count">{n}/{total}</span> : null;
  const progressBar = big ? <div className="slide-progress-bar" key={`prog-${entry.kind}-${entry.index}`} style={{ animationDuration: `${dwell}ms` }} /> : null;
  if (entry.kind === 'news') {
    const slice = newsPool.slice(entry.index * NEWS_PER_SLIDE, (entry.index + 1) * NEWS_PER_SLIDE);
    return (
      <div className="arch-news" key={`news-${entry.index}`} data-testid="onair-news-slide" data-kind="news">
        <span className="arch-news-label">NEWS NOW</span>
        {slice.map((h) => {
          const sc = sourceColor(h.source);
          return (
            <span className="arch-news-row" key={h.id}>
              <span className="arch-news-head">{h.text}</span>
              <span className="arch-news-src">
                <span className="arch-source-pill" style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: '4px', marginRight: '6px', fontWeight: 600 }}>{h.source}</span>
                {E.relativeAge(h.publishedMs, nowMs)}
              </span>
            </span>
          );
        })}
        {counter}
        {progressBar}
      </div>
    );
  }
  if (entry.kind === 'story') {
    const r = stories[entry.index]; const st = r.item; const label = dateLine(r, st.year);
    const isScan = /scan|page|doc/i.test(st.thumbUrl);
    return (
      <button type="button" className={compact ? 'arch-story compact' : 'arch-story'} key={`story-${st.id}`} onClick={(e) => onOpenStory?.(st, label, e.currentTarget)} data-testid="desk-story-item" aria-label={`Open story: ${st.headline}`} data-kind="story">
        {!bad[st.id] && <img className="arch-story-img" style={isScan ? { objectFit: 'contain', background: '#0b0d14' } : { objectFit: 'cover', objectPosition: 'center 30%' }} src={st.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [st.id]: true }))} />}
        <span className="arch-story-text">
          <span className="arch-story-dateline">{label} · {st.source}</span>
          <span className="arch-story-head">{st.headline}</span>
          <span className="arch-story-lead">{st.lead}</span>
          <span className="arch-story-tag">{isScan ? 'SCANNED DOCUMENT · ' : ''}DECLASSIFIED DESK · tap to read</span>
        </span>
        {counter}
        {progressBar}
      </button>
    );
  }
  if (entry.kind === 'rush' && rush) {
    return (
      <div className="arch-item arch-static" key="rush" data-testid="archive-otd-item" data-kind="archive">
        <span className="arch-text"><span className="arch-meta"><b>{rush.date.slice(0, 4)}</b> · LIBRARY</span><span className="arch-title">{rush.title}</span><span className="arch-col">Library recording · {rush.date}</span></span>
        {counter}
        {progressBar}
      </div>
    );
  }
  const it = items[entry.index];
  const img = !bad[it.identifier] && <img className="arch-thumb" style={{ objectFit: 'cover', objectPosition: 'center 30%' }} src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [it.identifier]: true }))} />;
  if (big) {
    const isScan = /scan|page|doc/i.test(it.thumbnail) || it.mediatype === 'texts';
    const caption = `${it.year} · ${KIND[it.mediatype]} · ${it.title} · ${it.collectionName}`;
    return (
      <div className="arch-story arch-big-two-col arch-static" key={it.identifier} data-testid="archive-otd-item" data-kind="archive">
        {!bad[it.identifier] && <img className="arch-story-img" style={isScan ? { objectFit: 'contain', background: '#0b0d14' } : { objectFit: 'cover', objectPosition: 'center 30%' }} src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [it.identifier]: true }))} />}
        <span className="arch-story-text">
          <span className="arch-story-dateline">{it.year} · {KIND[it.mediatype]}</span>
          <span className="arch-story-head">{it.title}</span>
          <span className="arch-story-lead">{it.collectionName}</span>
          <span className="arch-story-tag">{isScan ? 'SCANNED DOCUMENT · ' : ''}ARCHIVE ITEM</span>
        </span>
        {captionHost ? createPortal(<span title={caption}>{caption}</span>, captionHost) : null}
        {counter}
        {progressBar}
      </div>
    );
  }
  return (
    <div className={compact ? 'arch-item compact arch-static' : 'arch-item arch-static'} key={it.identifier} data-testid="archive-otd-item" data-kind="archive">
      {img}
      <span className="arch-text">
        <span className="arch-meta"><b>{it.year}</b> · {KIND[it.mediatype]}</span>
        <span className="arch-title">{it.title}</span>
        <span className="arch-col">{it.collectionName}</span>
      </span>
      {counter}
    </div>
  );
}
