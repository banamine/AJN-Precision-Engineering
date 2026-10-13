import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { suggest, highlightParts, nextActiveIndex, type SuggestCandidate, SUGGEST_MIN_CHARS } from '../utils/suggest';

const KIND_LABEL: Record<string, string> = { recent: 'Recent', history: 'Watched', favorite: 'Favorite', topic: 'Topic' };

interface SuggestInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Called when a suggestion is chosen (click or Enter) — the parent should run the search with this text. */
  onPick: (v: string) => void;
  candidates: SuggestCandidate[];
  inputRef?: React.Ref<HTMLInputElement>;
  id?: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  tabIndex?: number;
  onFocus?: () => void;
  /** Runs for keys the dropdown did not consume (e.g. the header's Escape-to-collapse). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Text input with an auto-fill dropdown: starts at 2 characters, ↑/↓ move, Enter picks the highlighted row (or submits the
 *  form as usual when none is highlighted), Esc closes the list first, matching letters are <mark>ed. ARIA combobox pattern. */
export function SuggestInput({ value, onChange, onPick, candidates, inputRef, id, placeholder, ariaLabel, className, tabIndex, onFocus, onKeyDown }: SuggestInputProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = useMemo(() => suggest(value, candidates), [value, candidates]);
  const shown = open && items.length > 0;
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { setActive(-1); }, [value]);
  useEffect(() => { if (active >= 0) listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' }); }, [active]);

  const pick = (text: string) => { setOpen(false); setActive(-1); onChange(text); onPick(text); };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        tabIndex={tabIndex}
        className={className}
        onChange={(e) => { onChange(e.target.value); setOpen(e.target.value.trim().length >= SUGGEST_MIN_CHARS); }}
        onFocus={() => { onFocus?.(); if (value.trim().length >= SUGGEST_MIN_CHARS) setOpen(true); }}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onKeyDown={(e) => {
          if (shown) {
            const next = nextActiveIndex(e.key, active, items.length);
            if (next !== null) { e.preventDefault(); setActive(next); return; }
            if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active].text); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); return; }
          } else if (e.key === 'ArrowDown' && items.length > 0) { e.preventDefault(); setOpen(true); setActive(0); return; }
          onKeyDown?.(e);
        }}
      />
      {shown && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Suggestions" data-testid="suggest-list"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-neutral-700 bg-neutral-950/98 p-1 shadow-xl backdrop-blur-md">
          {items.map((s, i) => (
            <li key={s.text} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active} data-testid="suggest-option"
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s.text)} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-sky-500/20 text-white' : 'text-neutral-200'}`}>
              <span className="min-w-0 truncate">
                {highlightParts(s.text, value).map((p, j) => p.match
                  ? <mark key={j} className="rounded-sm bg-transparent font-bold text-sky-300 underline decoration-sky-400/60 underline-offset-2">{p.text}</mark>
                  : <span key={j}>{p.text}</span>)}
              </span>
              {s.kind && <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">{KIND_LABEL[s.kind]}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
