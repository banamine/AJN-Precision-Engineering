/* "From the Archive · On This Day" panel body. One item at a time (carousel), full text wrapped, never ellipsised by line.
 * Each item is a real link that opens its Archive.org record in a NEW tab, so the page (and the audio deck) is never navigated away or touched. */
import { useState } from 'react';
import type { ArchiveItem, OnThisDay } from './useOnAirData';

export const ARCHIVE_DWELL_MS = 9000;
const KIND: Record<ArchiveItem['mediatype'], string> = { texts: 'READ', audio: 'LISTEN', movies: 'WATCH' };

export default function ArchiveOnThisDay({ items, rush, nowMs, compact }: { items: ArchiveItem[]; rush: OnThisDay | null; nowMs: number; compact: boolean }) {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const total = items.length + (rush ? 1 : 0);
  if (total === 0) return null;
  const i = Math.floor(nowMs / ARCHIVE_DWELL_MS) % total;
  const counter = total > 1 ? <span className="arch-count">{i + 1}/{total}</span> : null;
  if (i >= items.length && rush) {
    return (
      <div className="arch-item arch-static" key="rush" data-testid="archive-otd-item">
        <span className="arch-text"><span className="arch-meta"><b>{rush.date.slice(0, 4)}</b> · LIBRARY</span><span className="arch-title">{rush.title}</span><span className="arch-col">Library recording · {rush.date}</span></span>
        {counter}
      </div>
    );
  }
  const it = items[i];
  return (
    <a className={compact ? 'arch-item compact' : 'arch-item'} key={it.identifier} href={it.url} target="_blank" rel="noopener noreferrer" title="Opens on Archive.org in a new tab" data-testid="archive-otd-item">
      {!bad[it.identifier] && <img className="arch-thumb" src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((b) => ({ ...b, [it.identifier]: true }))} />}
      <span className="arch-text">
        <span className="arch-meta"><b>{it.year}</b> · {KIND[it.mediatype]}</span>
        <span className="arch-title">{it.title}</span>
        <span className="arch-col">{it.collectionName}</span>
      </span>
      {counter}
    </a>
  );
}
