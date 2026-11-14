import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star, Play, ChevronDown, ChevronRight, BadgeCheck } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import drawers from '../data/showDrawers.json';

/** Shows: genre channels with show "drawers". Additive; the timeline TV Guide is untouched.
 *  Data comes from tools/build-show-drawers.py (real Archive.org file lengths; a show is "verified" only
 *  when its first and last file answered a Range request on the build date). */

interface ShowRow {
  id: string; title: string; channelId: string; pill: string; tags: string[];
  episodes: number; hours: number | null; in24x7: boolean;
  verification: { ok: boolean; date: string; method: string };
}
interface Episode { t: string; p: string; d: number; s?: number; e?: number }
interface ContinueEntry { path: string; title: string; at: number }

const STARS_KEY = 'ajn.shows.starred.v1';
const CONTINUE_KEY = 'ajn.shows.continue.v1';
const VIEW_KEY = 'ajn.shows.view.v1';

function readJson<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: state lasts this session only */ }
}

const loaders = import.meta.glob('../data/showEpisodes/*.json') as Record<string, () => Promise<{ default: Episode[] }>>;
function loadEpisodes(id: string): Promise<Episode[]> {
  const load = loaders[`../data/showEpisodes/${id}.json`];
  if (!load) return Promise.reject(new Error(`No episode list for ${id}`));
  return load().then((m) => m.default);
}

const SHOWS = drawers.shows as ShowRow[];
const CHANNELS = drawers.channels as Array<{ id: string; label: string; name: string; pills: string[] }>;

interface Props { onSelectProgram: PlayProgramCallback }

export function ShowDrawersView({ onSelectProgram }: Props) {
  const saved = useMemo(() => readJson<{ channel?: string; pill?: string }>(VIEW_KEY, {}), []);
  const [channelId, setChannelId] = useState<string>(CHANNELS.some((c) => c.id === saved.channel) ? saved.channel! : CHANNELS[0].id);
  const channel = CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0];
  const [pill, setPill] = useState<string>(channel.pills.includes(saved.pill ?? '') ? saved.pill! : channel.pills[0]);
  const [stars, setStars] = useState<string[]>(() => readJson<string[]>(STARS_KEY, []));
  const [cont, setCont] = useState<Record<string, ContinueEntry>>(() => readJson<Record<string, ContinueEntry>>(CONTINUE_KEY, {}));
  const [openId, setOpenId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { writeJson(VIEW_KEY, { channel: channelId, pill }); }, [channelId, pill]);

  const pickChannel = (id: string) => {
    const next = CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
    setChannelId(next.id); setPill(next.pills[0]); setOpenId(null);
  };

  const toggleStar = (id: string) => setStars((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    writeJson(STARS_KEY, next); return next;
  });

  const visible = useMemo(() => SHOWS
    .filter((s) => s.channelId === channelId && s.pill === pill)
    .sort((a, b) => Number(stars.includes(b.id)) - Number(stars.includes(a.id)) || a.title.localeCompare(b.title)), [channelId, pill, stars]);

  const play = useCallback((show: ShowRow, ep: Episode) => {
    setCont((cur) => {
      const next = { ...cur, [show.id]: { path: ep.p, title: ep.t, at: Date.now() } };
      writeJson(CONTINUE_KEY, next); return next;
    });
    onSelectProgram(ep.p, ep.t, show.title, 'video', `show:${show.id}`, 'shows', `show:${show.id}:${ep.p}`);
  }, [onSelectProgram]);

  const toggleOpen = (show: ShowRow) => {
    if (openId === show.id) { setOpenId(null); return; }
    setOpenId(show.id); setEpisodes(null); setLoadError(null);
    loadEpisodes(show.id).then(setEpisodes).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  };

  const continueRows = useMemo(() => Object.entries(cont)
    .map(([id, c]) => ({ show: SHOWS.find((s) => s.id === id), c }))
    .filter((r): r is { show: ShowRow; c: ContinueEntry } => !!r.show)
    .sort((a, b) => b.c.at - a.c.at).slice(0, 6), [cont]);

  const playContinue = (show: ShowRow, c: ContinueEntry) => {
    onSelectProgram(c.path, c.title, show.title, 'video', `show:${show.id}`, 'shows', `show:${show.id}:${c.path}`);
    setCont((cur) => { const next = { ...cur, [show.id]: { ...c, at: Date.now() } }; writeJson(CONTINUE_KEY, next); return next; });
  };

  const playNext = (show: ShowRow) => {
    const c = cont[show.id];
    loadEpisodes(show.id).then((list) => {
      const i = c ? list.findIndex((e) => e.p === c.path) : -1;
      const ep = list[i + 1] ?? list[0];
      if (ep) play(show, ep);
    }).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 text-neutral-100" data-testid="shows-view">
      <h1 className="text-xl font-semibold mb-1">Shows</h1>
      <p className="text-sm text-neutral-400 mb-4">Browse by channel. The timeline guide is still under Live TV Guide.</p>

      {continueRows.length > 0 && (
        <section className="mb-5" aria-label="Continue watching">
          <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Continue watching</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {continueRows.map(({ show, c }) => (
              <button key={show.id} onClick={() => playContinue(show, c)}
                className="shrink-0 text-left rounded-md border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 px-3 py-2 max-w-[16rem]">
                <div className="text-sm font-medium truncate">{show.title}</div>
                <div className="text-xs text-neutral-400 truncate">{c.title}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <nav className="flex gap-2 overflow-x-auto pb-2" aria-label="Channels">
        {CHANNELS.map((c) => (
          <button key={c.id} onClick={() => pickChannel(c.id)} aria-pressed={c.id === channelId}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm border ${c.id === channelId ? 'border-[var(--ajn-accent)] text-white bg-neutral-800' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
            <span className="text-neutral-400 mr-1">{c.label}</span>{c.name}
          </button>
        ))}
      </nav>
      {channel.pills.length > 1 && (
        <div className="flex gap-2 overflow-x-auto py-2" aria-label="Genres">
          {channel.pills.map((p) => (
            <button key={p} onClick={() => { setPill(p); setOpenId(null); }} aria-pressed={p === pill}
              className={`shrink-0 rounded-full px-3 py-1 text-xs border ${p === pill ? 'border-[var(--ajn-accent)] text-white' : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'}`}>{p}</button>
          ))}
        </div>
      )}
      {pill === 'Westerns' && (
        <p className="text-xs text-neutral-400 mt-1">The 24/7 Westerns schedule is a channel in the Live TV Guide ("AJN Westerns").</p>
      )}

      <ul className="mt-3 space-y-2">
        {visible.map((show) => {
          const open = openId === show.id;
          const starred = stars.includes(show.id);
          return (
            <li key={show.id} className="rounded-md border border-neutral-800 bg-neutral-900">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleOpen(show)} aria-expanded={open} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="truncate font-medium">{show.title}</span>
                  {show.tags.map((t) => <span key={t} className="text-[10px] rounded bg-neutral-700 px-1.5 py-0.5">{t}</span>)}
                  {show.verification.ok && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-emerald-400" title={`First and last file answered a Range request on ${show.verification.date}`}>
                      <BadgeCheck size={13} />checked {show.verification.date}
                    </span>
                  )}
                </button>
                <span className="text-xs text-neutral-400 whitespace-nowrap">{show.episodes} ep{show.hours === null ? '' : ` • ${show.hours} h`}</span>
                <button onClick={() => playNext(show)} className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 inline-flex items-center gap-1" aria-label={`${cont[show.id] ? 'Next episode' : 'Play'} of ${show.title}`}>
                  <Play size={12} />{cont[show.id] ? 'Next' : 'Play'}
                </button>
                <button onClick={() => toggleStar(show.id)} aria-pressed={starred} aria-label={`${starred ? 'Unstar' : 'Star'} ${show.title}`}
                  className={starred ? 'text-yellow-400' : 'text-neutral-500 hover:text-neutral-300'}>
                  <Star size={16} fill={starred ? 'currentColor' : 'none'} />
                </button>
              </div>
              {open && (
                <div className="border-t border-neutral-800 px-3 py-2 max-h-96 overflow-y-auto">
                  {loadError && <p className="text-sm text-red-400">Episode list unavailable: {loadError}</p>}
                  {!loadError && !episodes && <p className="text-sm text-neutral-400">Loading episodes…</p>}
                  {episodes && (
                    <ol className="space-y-0.5">
                      {episodes.map((ep) => (
                        <li key={ep.p}>
                          <button onClick={() => play(show, ep)}
                            className={`w-full text-left text-sm rounded px-2 py-1 hover:bg-neutral-800 flex justify-between gap-3 ${cont[show.id]?.path === ep.p ? 'text-[var(--ajn-accent)]' : 'text-neutral-200'}`}>
                            <span className="truncate">{ep.s !== undefined ? `S${String(ep.s).padStart(2, '0')}E${String(ep.e ?? 0).padStart(2, '0')} · ` : ''}{ep.t}</span>
                            <span className="text-neutral-500 whitespace-nowrap">{ep.d > 0 ? `${Math.round(ep.d / 60)} min` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="text-sm text-neutral-400">Nothing in this drawer yet.</li>}
      </ul>
    </div>
  );
}

export default ShowDrawersView;
