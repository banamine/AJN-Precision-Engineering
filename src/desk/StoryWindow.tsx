/* The story window, shared by the Declassified Desk and the On Air page: news-article layout, original scan, raw OCR.
 * Drag the title bar, resize from any edge, maximize. The ONLY link to Archive.org on the Desk is "View original scan" in here. */
import './desk.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DeskItem } from './useDesk';

export function Pill({ item }: { item: DeskItem }) {
  return <span className={`dk-pill dk-${item.confidence.tone}`} title={item.confidence.basis === 'ocr' ? 'Mean OCR word confidence for this document' : item.confidence.basis === 'plain-text' ? 'Library text only; checked for clean words' : 'No OCR score available'}>{item.confidence.label}</span>;
}

type Geo = { x: number; y: number; w: number; h: number };
const GEO_KEY = 'ajn.deskWindow.v1';
const MIN_W = 320, MIN_H = 240;
const vw = () => window.innerWidth, vh = () => window.innerHeight;
const fit = (g: Geo): Geo => {
  const w = Math.min(Math.max(g.w, MIN_W), vw()), h = Math.min(Math.max(g.h, MIN_H), vh());
  return { w, h, x: Math.min(Math.max(g.x, 0), vw() - w), y: Math.min(Math.max(g.y, 0), vh() - h) };
};
const defaultGeo = (): Geo => { const w = Math.min(560, vw() - 24); return fit({ w, h: vh() - 24, x: vw() - w - 12, y: 12 }); };
function loadGeo(): Geo {
  try { const g = JSON.parse(localStorage.getItem(GEO_KEY) ?? 'null'); if (g && [g.x, g.y, g.w, g.h].every(Number.isFinite)) return fit(g); } catch { /* use default */ }
  return defaultGeo();
}

/** The document window: drag it by the title bar, resize it from any edge or corner, maximize it, or double-click the title bar. It is not modal, so the cards behind it stay usable. */
export function StoryWindow({ item, onClose, returnFocus, saved, onToggleSave, dateLabel }: { item: DeskItem; onClose: () => void; returnFocus: HTMLElement | null; saved: boolean; onToggleSave: () => void; dateLabel?: string }) {
  const isStory = item.cardType === 'story' && !!item.lead;
  const [tab, setTab] = useState<'article' | 'scan' | 'ocr'>(isStory ? 'article' : 'scan');
  const [bad, setBad] = useState(false);
  const [geo, setGeo] = useState<Geo>(loadGeo);
  const [max, setMax] = useState(false);
  const [narrow, setNarrow] = useState(() => vw() <= 640);
  const closeRef = useRef<HTMLButtonElement>(null);
  const geoRef = useRef(geo); geoRef.current = geo;
  useEffect(() => { setBad(false); setTab(isStory ? 'article' : 'scan'); }, [item.id, isStory]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onResize = () => { setNarrow(vw() <= 640); setGeo((g) => fit(g)); };
    window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); returnFocus?.focus(); };
  }, [onClose, returnFocus]);
  const save = (g: Geo) => { try { localStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch { /* not saved */ } };
  const grab = (dir: string) => (e: React.PointerEvent) => {
    if (max || narrow || e.button !== 0) return;
    e.preventDefault();
    let last = { ...geoRef.current }; const start = { ...geoRef.current }, sx = e.clientX, sy = e.clientY;
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy; let { x, y, w, h } = start;
      if (dir === 'drag') { x += dx; y += dy; }
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('s')) h = start.h + dy;
      if (dir.includes('w')) { w = start.w - dx; x = start.x + dx; if (w < MIN_W) { x = start.x + start.w - MIN_W; w = MIN_W; } }
      if (dir.includes('n')) { h = start.h - dy; y = start.y + dy; if (h < MIN_H) { y = start.y + start.h - MIN_H; h = MIN_H; } }
      last = fit({ x, y, w, h }); setGeo(last);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); save(last); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const full = max || narrow;
  const style: React.CSSProperties = full ? { left: 0, top: 0, width: '100vw', height: '100vh' } : { left: geo.x, top: geo.y, width: geo.w, height: geo.h };
  return createPortal(
    <aside className={`dk-win${full ? ' dk-win-max' : ''}`} style={style} role="dialog" aria-modal="false" aria-label={item.headline} data-testid="desk-drawer">
      {!full ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => <div key={d} className={`dk-rs dk-rs-${d}`} data-resize={d} onPointerDown={grab(d)} />) : null}
      <header className="dk-dhead" data-testid="desk-win-title" onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) grab('drag')(e); }} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button') && !narrow) setMax((m) => !m); }}>
        <div className="dk-dtitle"><h2>{item.headline}</h2><div className="dk-meta"><span className="dk-source">{item.source}</span><span>{item.year ?? 'Year unknown'}</span><Pill item={item} /></div></div>
        <div className="dk-wbtns">
          {!narrow ? <button type="button" onClick={() => setMax((m) => !m)} aria-label={max ? 'Restore window size' : 'Maximize window'} data-testid="desk-win-max">{max ? '❐' : '▢'}</button> : null}
          {!narrow && !max ? <button type="button" onClick={() => { const g = defaultGeo(); setGeo(g); save(g); }} aria-label="Reset window position and size" title="Reset position and size">⟲</button> : null}
          <button ref={closeRef} type="button" className="dk-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </header>
      <div className="dk-tabs" role="tablist">
        {isStory ? <button role="tab" aria-selected={tab === 'article'} onClick={() => setTab('article')}>Story</button> : null}
        <button role="tab" aria-selected={tab === 'scan'} onClick={() => setTab('scan')}>Original scan</button>
        <button role="tab" aria-selected={tab === 'ocr'} onClick={() => setTab('ocr')}>Raw OCR</button>
      </div>
      <div className="dk-dbody">
        {tab === 'article' && isStory ? (
          <article className="dk-article" data-testid="story-article">
            <p className="dk-dateline">{[dateLabel ?? (item.year ? String(item.year) : 'Date unknown'), item.source, item.pages ? `${item.pages} ${item.pages === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(' · ')}</p>
            {bad ? null : <img className="dk-hero" src={item.pageUrl} alt={`First page of ${item.headline}`} referrerPolicy="no-referrer" onError={() => setBad(true)} />}
            <p className="dk-lede">{item.lead}</p>
            {item.excerpt && item.excerpt.length > (item.lead?.length ?? 0) + 40 ? (
              <details className="dk-more"><summary>Read more from the document</summary><p>{item.excerpt}</p></details>
            ) : null}
            <p className="dk-prov">Copied word for word from a scanned government document. <Pill item={item} /> The text was read by machine and can contain errors; the original scan is the record.</p>
          </article>
        ) : tab === 'scan'
          ? (bad ? <p className="dk-note">No page image is available for this document.</p>
            : <img className="dk-page" src={item.pageUrl} alt={`First page of ${item.headline}`} referrerPolicy="no-referrer" onError={() => setBad(true)} />)
          : <pre className="dk-ocr">{item.rawOcr}</pre>}
      </div>
      <footer className="dk-wfoot">
        <button type="button" className="dk-savebtn" onClick={onToggleSave} aria-pressed={saved} data-testid="story-save">{saved ? '★ Saved' : '☆ Save story'}</button>
        <a className="dk-orig" href={`https://archive.org/details/${encodeURIComponent(item.archiveId)}`} target="_blank" rel="noopener noreferrer" data-testid="story-original-link">View original scan</a>
      </footer>
    </aside>,
    document.body,
  );
}

