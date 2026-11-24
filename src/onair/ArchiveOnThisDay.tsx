/* "From the Library · On This Day" panel body. One entry at a time: Declassified Desk stories (news-article cards, click to open the story window),
 * real Archive items from the library, and the library recording. Full text wrapped, never ellipsised by line.
 * Library items are display only: no links leave the page. */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArchiveItem, OnThisDay } from './useOnAirData';
import type { RankedStory } from '../desk/onThisDay';
import { dateLine } from '../desk/onThisDay';
import { buildEntries, pickEntry, ITEM_DWELL_MS } from './archiveEntries';
import type { DeskItem } from '../desk/useDesk';

export const ARCHIVE_DWELL_MS = ITEM_DWELL_MS;
const KIND: Record<ArchiveItem['mediatype'], string> = { texts: 'READ', audio: 'LISTEN', movies: 'WATCH' };

export default function ArchiveOnThisDay({ items, rush, stories = [], nowMs, compact, onOpenStory, big, captionHost }: { big?: boolean; captionHost?: HTMLElement | null; items: ArchiveItem[]; rush: OnThisDay | null; stories?: RankedStory[]; nowMs: number; compact: boolean; onOpenStory?: (item: DeskItem, dateLabel: string, el: HTMLElement) => void }) {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const entries = buildEntries(stories.length, stories.filter((s) => s.near).length, items.length, !!rush);
  const pick = pickEntry(entries, nowMs);
  if (!pick) return null;
  const { entry, n, total } = pick;
  const counter = total > 1 ? <span className="arch-count">{n}/{total}</span> : null;
  if (entry.kind === 'story') {
    const r = stories[entry.index]; const st = r.item; const label = dateLine(r, st.year);
    return (
      <button type="button" className={compact ? 'arch-story compact' : 'arch-story'} key={`story-${st.id}`} onClick={(e) => onOpenStory?.(st, label, e.currentTarget)} data-testid="desk-story-item" aria-label={`Open story: ${st.headline}`}>
        {!bad[st.id] && <img className="arch-story-img" src={st.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [st.id]: true }))} />}
        <span className="arch-story-text">
          <span className="arch-story-dateline">{label} · {st.source}</span>
          <span className="arch-story-head">{st.headline}</span>
          <span className="arch-story-lead">{st.lead}</span>
          <span className="arch-story-tag">DECLASSIFIED DESK · tap to read</span>
        </span>
        {counter}
      </button>
    );
  }
  if (entry.kind === 'rush' && rush) {
    return (
      <div className="arch-item arch-static" key="rush" data-testid="archive-otd-item">
        <span className="arch-text"><span className="arch-meta"><b>{rush.date.slice(0, 4)}</b> · LIBRARY</span><span className="arch-title">{rush.title}</span><span className="arch-col">Library recording · {rush.date}</span></span>
        {counter}
      </div>
    );
  }
  const it = items[entry.index];
  const img = !bad[it.identifier] && <img className="arch-thumb" src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [it.identifier]: true }))} />;
  if (big) {
    // Big panel: the picture fills the panel; its caption lives in the panel header, not in the body.
    const caption = `${it.year} · ${KIND[it.mediatype]} · ${it.title} · ${it.collectionName}`;
    return (
      <div className="arch-item arch-static arch-big" key={it.identifier} data-testid="archive-otd-item">
        {img}
        {captionHost ? createPortal(<span title={caption}>{caption}</span>, captionHost) : null}
        {counter}
      </div>
    );
  }
  return (
    <div className={compact ? 'arch-item compact arch-static' : 'arch-item arch-static'} key={it.identifier} data-testid="archive-otd-item">
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
