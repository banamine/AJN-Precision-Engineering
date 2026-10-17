import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { getShowInfoByChannelId } from '../showinfo/lookup';
import type { ShowInfo } from '../showinfo/types';
import type { FallbackShowInfo } from '../showinfo/fallback';

const SHOW_INFO_OPEN_EVENT = 'ajn:show-info-open';

interface ShowInfoButtonProps {
  channelId: string;
  title: string;
  /** Used only when showInfo.json has no entry for this channel. */
  fallback?: FallbackShowInfo;
}

interface OverlayPosition {
  top?: number;
  left?: number;
  bottom?: number;
  width?: number | string;
  maxHeight?: number | string;
}

function yearLabel(info: ShowInfo): string {
  const { start, end } = info.years;
  if (start !== null && end !== null) return start === end ? String(start) : `${start}–${end}`;
  if (start !== null) return `${start}–`;
  if (end !== null) return `–${end}`;
  return '';
}

function statusLabel(status: ShowInfo['details']['status']): string {
  if (status === 'ended') return 'Ended';
  if (status === 'running') return 'Running';
  return 'Status unavailable';
}

function clamped(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function dialogPosition(anchor: HTMLElement): OverlayPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < 640) {
    return {
      left: 0,
      bottom: 0,
      width: '100vw',
      maxHeight: '70vh',
    };
  }

  const rect = anchor.getBoundingClientRect();
  const panelWidth = Math.min(352, viewportWidth - 24);
  const maxHeight = Math.max(120, Math.min(640, viewportHeight - 24));
  let top = rect.bottom + 8;
  if (top + maxHeight > viewportHeight - 12) top = rect.top - maxHeight - 8;
  top = clamped(top, 12, viewportHeight - maxHeight - 12);
  return {
    top,
    left: clamped(rect.left, 12, viewportWidth - panelWidth - 12),
    width: panelWidth,
    maxHeight,
  };
}

function tooltipPosition(anchor: HTMLElement): OverlayPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(352, viewportWidth - 16);
  const below = rect.bottom + 8;
  const top = below + 72 <= viewportHeight ? below : Math.max(8, rect.top - 56);
  return {
    top,
    left: clamped(rect.left, 8, viewportWidth - width - 8),
    width,
  };
}

export function ShowInfoButton({ channelId, title, fallback }: ShowInfoButtonProps) {
  const info = getShowInfoByChannelId(channelId);
  const hasCard = Boolean(info || fallback);
  const generatedId = useId().replaceAll(':', '');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [dialogCoords, setDialogCoords] = useState<OverlayPosition | null>(null);
  const [tooltipCoords, setTooltipCoords] = useState<OverlayPosition | null>(null);

  const buttonId = `show-info-button-${generatedId}`;
  const tooltipId = `show-info-tooltip-${generatedId}`;
  const dialogId = `show-info-dialog-${generatedId}`;
  const titleId = `show-info-title-${generatedId}`;
  const overviewId = `show-info-overview-${generatedId}`;
  const moreInfoId = `show-info-more-${generatedId}`;
  const tooltipVisible = Boolean(info?.blurb.trim()) && canHover && (isHovered || isFocused) && !isOpen;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!hasCard) return;
    const onOtherDialogOpened = (event: Event) => {
      const otherDialogId = (event as CustomEvent<string>).detail;
      if (otherDialogId !== dialogId) {
        setIsOpen(false);
        setMoreInfoOpen(false);
      }
    };
    document.addEventListener(SHOW_INFO_OPEN_EVENT, onOtherDialogOpened);
    return () => document.removeEventListener(SHOW_INFO_OPEN_EVENT, onOtherDialogOpened);
  }, [dialogId, hasCard]);

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();

    const reposition = () => {
      if (buttonRef.current) setDialogCoords(dialogPosition(buttonRef.current));
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || dialogRef.current?.contains(target)) return;
      closeDialog(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeDialog(true);
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!tooltipVisible) return;
    const reposition = () => {
      if (buttonRef.current) setTooltipCoords(tooltipPosition(buttonRef.current));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsHovered(false);
      setIsFocused(false);
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tooltipVisible]);

  function closeDialog(restoreFocus: boolean) {
    setIsOpen(false);
    setMoreInfoOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  function handleButtonClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setIsHovered(false);
    setIsFocused(false);
    if (isOpen) {
      closeDialog(true);
      return;
    }
    const anchor = buttonRef.current;
    if (anchor) setDialogCoords(dialogPosition(anchor));
    document.dispatchEvent(new CustomEvent(SHOW_INFO_OPEN_EVENT, { detail: dialogId }));
    setIsOpen(true);
  }

  if (!info && !fallback) return null;

  const cardTitle = info ? info.title : fallback!.title;
  const cardOverview = info ? info.overview : fallback!.overview;
  const years = info ? yearLabel(info) : '';
  const genres = info ? info.genres.join(', ') : '';
  const yearsAndGenres = info ? [years, genres].filter(Boolean).join(' · ') : fallback!.subtitle;
  const dialog = isOpen && dialogCoords && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={cardOverview ? overviewId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`z-[100] overflow-y-auto border border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl outline-none ${
          window.innerWidth < 640
            ? 'fixed rounded-t-2xl p-4 pb-6'
            : 'fixed rounded-2xl p-4'
        }`}
        style={dialogCoords}
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 text-base font-semibold leading-snug text-neutral-50">
            {cardTitle}
          </h2>
          <button
            type="button"
            onClick={() => closeDialog(true)}
            aria-label="Close show information"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {yearsAndGenres && <p className="mt-1 text-xs text-neutral-400">{yearsAndGenres}</p>}
        {cardOverview && (
          <p id={overviewId} className="mt-3 text-sm leading-6 text-neutral-300">
            {cardOverview}
          </p>
        )}
        {info && info.cast.length > 0 && (
          <p className="mt-3 text-xs text-neutral-300">
            <span className="font-semibold text-neutral-100">Cast: </span>
            {info.cast.slice(0, 5).map((member) => member.name).join(', ')}
          </p>
        )}

        <button
          type="button"
          aria-expanded={moreInfoOpen}
          aria-controls={moreInfoId}
          onClick={() => setMoreInfoOpen((open) => !open)}
          className="mt-4 rounded-md text-xs font-medium text-sky-300 underline decoration-sky-700 underline-offset-2 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          More info
        </button>
        <div id={moreInfoId} hidden={!moreInfoOpen} className="mt-3 space-y-2 border-t border-neutral-800 pt-3 text-xs text-neutral-300">
          {info ? (
            <>
              {info.details.network && <p>Network: {info.details.network}</p>}
              <p>Status: {statusLabel(info.details.status)}</p>
              {info.cast.length > 0 && (
                <p>Full cast: {info.cast.map((member) => member.role
                  ? `${member.name} as ${member.role}`
                  : member.name).join(', ')}</p>
              )}
              {info.details.note && <p>{info.details.note}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {info.links.imdbUrl && (
                  <a href={info.links.imdbUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">
                    IMDb
                  </a>
                )}
                <a href={info.source.url} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">
                  TVmaze
                </a>
              </div>
              <p className="text-[10px] text-neutral-500">Data: TVmaze (CC BY-SA)</p>
            </>
          ) : (
            <>
              {fallback!.facts.map((fact) => <p key={fact}>{fact}</p>)}
              {fallback!.link && (
                <a href={fallback!.link.href} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">
                  {fallback!.link.label}
                </a>
              )}
              <p className="text-[10px] text-neutral-500">Built from this channel’s own schedule data. No curated description is available yet.</p>
            </>
          )}
        </div>
      </div>,
      document.body,
    )
    : null;

  const tooltip = tooltipVisible && tooltipCoords && typeof document !== 'undefined'
    ? createPortal(
      <div
        id={tooltipId}
        role="tooltip"
        className="fixed z-[110] rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs leading-relaxed text-neutral-100 shadow-xl"
        style={tooltipCoords}
      >
        {info?.blurb}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-label={`About ${cardTitle}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dialogId}
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        onClick={handleButtonClick}
        onMouseEnter={() => { if (canHover) setIsHovered(true); }}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => { if (canHover) setIsFocused(true); }}
        onBlur={() => setIsFocused(false)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sky-300 hover:bg-neutral-800 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {dialog}
      {tooltip}
    </>
  );
}
