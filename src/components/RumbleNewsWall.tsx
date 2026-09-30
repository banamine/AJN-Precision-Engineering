import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Play, RotateCcw, Square } from 'lucide-react';
import { RUMBLE_BASELINE } from '../rumble/baseline';
import { fetchRumbleBaseline } from '../rumble/baselineClient';
import type { RumbleBaseline } from '../rumble/types';
import {
  buildNewsWall,
  embedUrl,
  listPickerSources,
  parseEmbedId,
  toSource,
  type WallSource,
} from '../rumble/wall';

function initialSlots(baseline: RumbleBaseline): WallSource[] {
  return buildNewsWall(baseline).map((item) => toSource(item, baseline));
}

function formatViewers(viewers?: number): string | null {
  if (!viewers) return null;
  return viewers >= 1000 ? `${(viewers / 1000).toFixed(viewers >= 10000 ? 0 : 1)}K` : String(viewers);
}

interface PanelProps {
  source: WallSource;
  options: WallSource[];
  active: boolean;
  focused: boolean;
  onChange: (source: WallSource) => void;
  onActivate: () => void;
  onToggleFocus: () => void;
}

function WallPanel({ source, options, active, focused, onChange, onActivate, onToggleFocus }: PanelProps) {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState(false);
  const inList = options.some((option) => option.embedId === source.embedId);
  const viewers = formatViewers(source.viewers);

  const applyCustom = () => {
    const embedId = parseEmbedId(custom);
    if (!embedId) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    setCustom('');
    onChange({ key: `custom-${embedId}`, embedId, label: 'Custom embed', detail: embedId, backup: true });
  };

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
      aria-label={source.label}
    >
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="truncate text-sm font-semibold text-neutral-100">{source.label}</span>
        {source.pinned && (
          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-mono uppercase text-sky-300">pinned</span>
        )}
        {source.backup && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono uppercase text-amber-300">backup</span>
        )}
        {viewers && (
          <span className="shrink-0 font-mono text-[11px] text-neutral-400" title="Viewer count from the last import (not live)">
            {viewers}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleFocus}
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          aria-label={focused ? 'Back to grid' : `Expand ${source.label}`}
          title={focused ? 'Back to grid' : 'Expand'}
        >
          {focused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </header>

      <div className="relative aspect-video w-full bg-black">
        {active ? (
          <iframe
            key={source.embedId}
            src={embedUrl(source.embedId)}
            title={`${source.label} (Rumble)`}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={onActivate}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
          >
            <Play className="h-10 w-10" />
            <span className="text-xs">Load {source.label}</span>
          </button>
        )}
      </div>

      <footer className="flex flex-col gap-2 px-3 py-2">
        <p className="truncate text-xs text-neutral-400" title={source.detail}>{source.detail}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={inList ? source.embedId : '__custom'}
            onChange={(event) => {
              const next = options.find((option) => option.embedId === event.target.value);
              if (next) onChange(next);
            }}
            aria-label={`Stream for ${source.label}`}
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {!inList && <option value="__custom">{source.label}</option>}
            <optgroup label="Live now (by viewers)">
              {options.filter((option) => !option.backup).map((option) => (
                <option key={option.key} value={option.embedId}>
                  {option.label}{option.viewers ? ` — ${formatViewers(option.viewers)}` : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="Backups">
              {options.filter((option) => option.backup).map((option) => (
                <option key={option.key} value={option.embedId}>{option.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyCustom();
          }}
        >
          <input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setCustomError(false);
            }}
            placeholder="Paste embed ID or embed URL"
            aria-label={`Custom embed for ${source.label}`}
            aria-invalid={customError}
            className={`min-w-0 flex-1 rounded-md border bg-neutral-950 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              customError ? 'border-red-500' : 'border-neutral-700'
            }`}
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Go
          </button>
        </form>
        {customError && (
          <p className="text-[11px] text-red-400" role="alert">
            Not an embed ID. Use something like v33aw1a or https://rumble.com/embed/v33aw1a/
          </p>
        )}
      </footer>
    </section>
  );
}

export function RumbleNewsWall() {
  const [baseline, setBaseline] = useState<RumbleBaseline>(RUMBLE_BASELINE);
  const [slots, setSlots] = useState<WallSource[]>(() => initialSlots(RUMBLE_BASELINE));
  const [active, setActive] = useState<boolean[]>([true, true, true, true]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const touched = useRef(false);

  // Prefer the server's baseline when it answers; the bundled one is the fallback.
  useEffect(() => {
    let cancelled = false;
    void fetchRumbleBaseline().then(({ baseline: fetched }) => {
      if (cancelled || !fetched) return;
      setBaseline(fetched);
      if (!touched.current) setSlots(initialSlots(fetched));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => listPickerSources(baseline), [baseline]);
  const anyActive = active.some(Boolean);
  const visible = focusIndex === null ? slots.map((_, index) => index) : [focusIndex];

  const updateSlot = (index: number, source: WallSource) => {
    touched.current = true;
    setSlots((current) => current.map((slot, i) => (i === index ? source : slot)));
    setActive((current) => current.map((flag, i) => (i === index ? true : flag)));
  };

  const reset = () => {
    touched.current = false;
    setSlots(initialSlots(baseline));
    setActive([true, true, true, true]);
    setFocusIndex(null);
  };

  return (
    <div className="w-full pb-24 md:pb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">News Wall</h1>
          <p className="text-xs text-neutral-400">
            RT News 24/7 is pinned; the other panels are the highest-viewer live streams from the last import
            ({new Date(baseline.generatedAt).toLocaleString()}). Viewer counts are a snapshot, and a stream may
            have ended since. Pick another from any panel's list. Press play inside a panel to start it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActive(anyActive ? [false, false, false, false] : [true, true, true, true])}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {anyActive ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {anyActive ? 'Stop all' : 'Load all'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset picks
          </button>
        </div>
      </div>

      <div className={focusIndex === null ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : 'grid grid-cols-1 gap-4'}>
        {visible.map((index) => (
          <div key={index} className="min-w-0">
          <WallPanel
            source={slots[index]}
            options={options}
            active={active[index]}
            focused={focusIndex === index}
            onChange={(source) => updateSlot(index, source)}
            onActivate={() => setActive((current) => current.map((flag, i) => (i === index ? true : flag)))}
            onToggleFocus={() => setFocusIndex(focusIndex === index ? null : index)}
          />
          </div>
        ))}
      </div>
    </div>
  );
}
