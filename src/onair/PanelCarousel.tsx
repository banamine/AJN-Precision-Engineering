import { pickPage, sizeClass } from './panelCarouselLogic';

/* Build 13: one full item at a time for Headlines/Digest. Logic lives in panelCarouselLogic.ts. */
export default function PanelCarousel({ items, nowMs }: { items: string[]; nowMs: number }) {
  const pg = pickPage(items, nowMs);
  if (!pg) return null;
  return (
    <div className={`pc-item ${sizeClass(pg.text)}`} key={`${pg.n}-${pg.text.length}`} data-testid="panel-carousel-item">
      <span className="pc-text">{pg.text}</span>
      {pg.total > 1 && <span className="pc-count">{pg.n}/{pg.total}</span>}
    </div>
  );
}
