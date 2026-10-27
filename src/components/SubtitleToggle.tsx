import { useEffect, useState } from 'react';
import { Captions } from 'lucide-react';

const PREF_KEY = 'ajn.subtitles.en.v1';
const readPref = () => { try { return window.localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; } };
const writePref = (on: boolean) => { try { window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

type Availability = 'checking' | 'available' | 'none';

/**
 * English subtitle switch for Archive videos. Shows only once the <track> actually loaded an English file;
 * nothing is shown for items without one. Reads the track from the live <video> (it is swapped per source).
 */
export function SubtitleToggle({ getVideo }: { getVideo: () => HTMLVideoElement | null }) {
  const [on, setOn] = useState(readPref);
  const [availability, setAvailability] = useState<Availability>('none');

  useEffect(() => {
    const sync = () => {
      const video = getVideo();
      const el = video?.querySelector<HTMLTrackElement>('track[data-ajn-subtitles="en"]') ?? null;
      if (!el) { setAvailability('none'); return; }
      const track = el.track;
      // A disabled track never loads; "hidden" loads it without drawing, "showing" draws it.
      const wanted: TextTrackMode = on ? 'showing' : 'hidden';
      if (track.mode !== wanted) track.mode = wanted;
      setAvailability(el.readyState === 2 ? 'available' : el.readyState === 3 ? 'none' : 'checking');
    };
    sync();
    const t = window.setInterval(sync, 1000);
    return () => window.clearInterval(t);
  }, [getVideo, on]);

  if (availability !== 'available') return null;
  return (
    <button
      type="button"
      data-testid="subtitle-toggle"
      aria-pressed={on}
      onClick={() => { const next = !on; setOn(next); writePref(next); }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${on ? 'border-sky-500/60 bg-sky-950/50 text-sky-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}
    >
      <Captions aria-hidden="true" className="h-4 w-4" />
      English subtitles: {on ? 'On' : 'Off'}
    </button>
  );
}
