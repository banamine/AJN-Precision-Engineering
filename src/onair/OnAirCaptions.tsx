/* Live captions beside a news clip on On Air. Uses the same caption pipeline as the player (useCaptionTrack); it only shows
 * real caption text, labelled with its kind (aligned / broadcast closed captions / speech recognition). No caption file: it says so. */
import { useLayoutEffect, useRef } from 'react';
import type { CaptionState } from '../news/captions/useCaptionTrack';

/** The /download/ID/ID.mp4 path inside a clip's proxy URL, or undefined for anything else. */
export function archivePathOf(src: string | undefined): string | undefined {
  if (!src) return undefined;
  try {
    const u = new URL(src, 'http://local');
    const p = u.searchParams.get('path');
    if (p) return p;
    return u.pathname.startsWith('/download/') ? `${u.pathname}${u.search}` : undefined;
  } catch { return undefined; }
}

export default function OnAirCaptions({ state }: { state: CaptionState }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { const l = listRef.current; if (l) l.scrollTop = l.scrollHeight; }, [state]);
  if (state.phase === 'off') return null;
  let head = 'Captions', body: React.ReactNode;
  if (state.phase === 'planning') body = <div className="cap-note">Looking for captions…</div>;
  else if (state.phase === 'none') body = <div className="cap-note">No captions for this clip.</div>;
  else if (state.phase === 'paused') body = <div className="cap-note">Captions paused: Internet Archive asked us to slow down (about {state.retryAfter} s).</div>;
  else if (state.phase === 'error') body = <div className="cap-note">Captions unavailable ({state.reason}).</div>;
  else {
    head = `Captions · ${state.label}`;
    body = (
      <div className="cap-list" ref={listRef} data-testid="onair-captions-list">
        {state.before.slice(-5).map((c) => <p key={`${c.start}|${c.text}`} className="cap-old">{c.text}</p>)}
        <p className="cap-now" data-testid="onair-captions-current">{state.current ? state.current.text : state.waiting ? '…' : ''}</p>
      </div>
    );
  }
  return <div className="onair-captions" data-testid="onair-captions"><div className="side-heading"><span>{head}</span></div>{body}</div>;
}
