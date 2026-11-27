import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { rememberPodcastArt } from '../utils/podcastArt';
import { Bell, Play, Trash2 } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import { TERM_TYPES, type AlertHit, type AlertRule, type TermType } from '../utils/alertMatch';
import { canAddRule, loadRules, loadSeen, ruleFromDraft, saveRules, saveSeen, type RuleDraft } from '../utils/alertRules';
import { setAlertHits } from '../utils/alertHitsStore';
import { fmtClock, startAtFor } from '../utils/alertSkip';

interface ShowLine { showId: string; name: string; reason: string; warnings: string[] }
interface Status {
  state: 'idle' | 'building' | 'refreshing' | 'ready' | 'error'; error: string | null; builtAt: string | null;
  window: { days: number; episodesPerShow: number; archiveAfterDays: number; eligibleShare: number };
  covered: ShowLine[]; archive: ShowLine[]; uncovered: ShowLine[]; quarantined: ShowLine[];
  warnings: { showId: string; name: string; warnings: string[] }[];
  stats: { durationMs: number; episodes: { indexed: number; reused: number; failed: number; noCues: number; oversized: number }; http: { r429: number; r5xx: number }; rssMB: number } | null;
  indexedEpisodes: number;
}
interface MatchBody { state: string; error?: string | null; builtAt: string | null; hits: AlertHit[]; scanned: number; truncated: boolean }

const POLL_MS = 4000;
const emptyDraft = (): RuleDraft => ({ name: '', showIds: null, terms: [{ type: 'keyword', text: '', aliases: '' }] });
const when = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

async function getJson<T>(url: string, init: RequestInit | undefined, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Listen deck > Alerts. Rules and "seen" live in this browser; the server only holds the transcript index and sees the rules for one request. */
export function ListenAlertsPanel({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }): ReactElement {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules());
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen());
  const [status, setStatus] = useState<Status | null>(null);
  const [match, setMatch] = useState<MatchBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [note, setNote] = useState('');
  const [showLib, setShowLib] = useState(false);
  const [showWho, setShowWho] = useState(false);

  // Poll the index status while the panel is open (fast while it is still building, slow once ready).
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController(); let timer: number | undefined;
    const tick = async () => {
      try { const s = await getJson<Status>('/api/alerts/status', undefined, ac.signal); setStatus(s); setError(null); timer = window.setTimeout(tick, s.state === 'ready' ? 60_000 : POLL_MS); }
      catch (e: any) { if (e?.name === 'AbortError') return; setError(`Alerts are unavailable: ${e?.message ?? e}`); timer = window.setTimeout(tick, 15_000); }
    };
    void tick();
    return () => { ac.abort(); if (timer) window.clearTimeout(timer); };
  }, [open]);

  // Re-check the rules whenever they change or the index was rebuilt.
  const builtAt = status?.builtAt ?? null; const ready = status?.state === 'ready' || status?.state === 'refreshing';
  useEffect(() => {
    if (!open || !ready || !rules.some((r) => r.enabled)) { if (open && ready) { setMatch(null); setAlertHits([]); } return; }
    const ac = new AbortController();
    getJson<MatchBody>('/api/alerts/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) }, ac.signal)
      .then((m) => { setMatch(m); setAlertHits(m.hits); setError(null); })
      .catch((e: any) => { if (e?.name !== 'AbortError') setError(`Could not check your alerts: ${e?.message ?? e}`); });
    return () => ac.abort();
  }, [open, ready, builtAt, rules]);

  const persistRules = useCallback((next: AlertRule[]) => { setRules(next); if (!saveRules(next)) setNote('Could not save in this browser (private mode or full storage): your alerts will be gone when you close the tab.'); }, []);
  const seenRef = useRef(seen); seenRef.current = seen;
  const markSeen = useCallback((ids: string[]) => { const next = new Set(seenRef.current); for (const id of ids) next.add(id); setSeen(next); saveSeen(next); }, []);

  const hits = match?.hits ?? [];
  const fresh = useMemo(() => hits.filter((h) => !h.archive), [hits]);
  const library = useMemo(() => hits.filter((h) => h.archive), [hits]);
  const unseen = fresh.filter((h) => !seen.has(h.id)).length;
  const coveredShows = status?.covered ?? [];

  const save = () => {
    const rule = ruleFromDraft(draft);
    if (!rule) { setNote('Give the alert a name and at least one word or phrase of 2+ letters.'); return; }
    if (!canAddRule(rules)) { setNote('That is the maximum number of alerts. Delete one first.'); return; }
    persistRules([...rules, rule]); setDraft(emptyDraft()); setNote(`Saved "${rule.name}".`);
  };
  const play = (h: AlertHit) => { markSeen([h.id]); rememberPodcastArt(h.channelId, h.logo); onPlayProgram(h.url, h.title, h.showName, 'audio', h.channelId, 'audio-podcasts', h.programId, undefined, undefined, startAtFor(h)); };
  const setTerm = (i: number, patch: Partial<RuleDraft['terms'][number]>) => setDraft((d) => ({ ...d, terms: d.terms.map((t, k) => (k === i ? { ...t, ...patch } : t)) }));

  const label = status?.state === 'ready' || status?.state === 'refreshing'
    ? `Index covers the last ${status.window.days} days (up to ${status.window.episodesPerShow} episodes per show), built ${new Date(status.builtAt!).toLocaleTimeString()}${status.state === 'refreshing' ? ' · refreshing' : ''}.`
    : status?.state === 'error' ? `The transcript index could not be built: ${status.error ?? 'unknown error'}.` : 'Building the transcript index… this takes a minute after a restart.';

  return (
    <section className="ajr-section" id="ajr-alerts" aria-label="Listen alerts" data-testid="listen-alerts">
      <div className="ajr-heading"><div><div className="ajr-label">PODCAST TRANSCRIPTS</div><h2>Listen <em>alerts.</em></h2></div><span className="ajr-aside">WORDS AND NAMES, FOUND IN WHAT WAS SAID.</span></div>
      <button type="button" data-testid="alerts-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="ajr-chip selected inline-flex items-center gap-2">
        <Bell size={14} aria-hidden="true" />{open ? 'HIDE ALERTS' : 'OPEN ALERTS'}{open && unseen > 0 ? ` · ${unseen} NEW` : ''}
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <p className="ajr-status" role="status" aria-live="polite" data-testid="alerts-status">{label} Text comes from each show&rsquo;s own published transcript (clean-show time, no ads).</p>
          {error && <p role="alert" data-testid="alerts-error" className="rounded border border-red-300/40 bg-red-400/10 px-2 py-1 text-xs text-red-100">{error}</p>}
          {note && <p className="text-xs text-neutral-300" data-testid="alerts-note">{note}</p>}

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <h3 className="m-0 mb-2 text-sm font-semibold text-white">New alert</h3>
            <div className="grid gap-2">
              <input data-testid="alert-name" className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white" placeholder="Name (e.g. Competitors)" aria-label="Alert name" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              {draft.terms.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select aria-label="Kind of term" data-testid="alert-term-type" className="rounded border border-white/15 bg-black/40 px-1.5 py-1.5 text-xs text-white" value={t.type} onChange={(e) => setTerm(i, { type: e.target.value as TermType })}>
                    {TERM_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <input data-testid="alert-term-text" className="min-w-[10rem] flex-1 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white" placeholder="Word or phrase" aria-label="Word or phrase" maxLength={80} value={t.text} onChange={(e) => setTerm(i, { text: e.target.value })} />
                  <input data-testid="alert-term-aliases" className="min-w-[10rem] flex-1 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white" placeholder="Also match (comma separated)" aria-label="Aliases, comma separated" value={t.aliases} onChange={(e) => setTerm(i, { aliases: e.target.value })} />
                  {draft.terms.length > 1 && <button type="button" aria-label="Remove this term" className="ck-key ck-key--icon" onClick={() => setDraft((d) => ({ ...d, terms: d.terms.filter((_, k) => k !== i) }))}><Trash2 size={14} /></button>}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
                <button type="button" data-testid="alert-add-term" className="ajr-chip" onClick={() => setDraft((d) => ({ ...d, terms: [...d.terms, { type: 'keyword', text: '', aliases: '' }] }))}>+ TERM</button>
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" data-testid="alert-scope-shows" checked={draft.showIds !== null} onChange={(e) => setDraft({ ...draft, showIds: e.target.checked ? [] : null })} /> Only some shows</label>
                <button type="button" data-testid="alert-save" className="ajr-chip selected" onClick={save}>SAVE ALERT</button>
              </div>
              {draft.showIds !== null && (
                <fieldset className="m-0 grid max-h-40 gap-1 overflow-y-auto rounded border border-white/10 p-2 text-xs text-neutral-200" data-testid="alert-show-list">
                  <legend className="px-1 text-[10px] uppercase tracking-widest text-neutral-400">Shows with transcripts</legend>
                  {coveredShows.length === 0 && <span>The list appears once the index is ready.</span>}
                  {coveredShows.map((s) => (
                    <label key={s.showId} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.showIds!.includes(s.showId)} onChange={(e) => setDraft((d) => ({ ...d, showIds: e.target.checked ? [...(d.showIds ?? []), s.showId] : (d.showIds ?? []).filter((x) => x !== s.showId) }))} />{s.name}</label>
                  ))}
                </fieldset>
              )}
            </div>
          </div>

          {rules.length > 0 && (
            <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Your alerts">
              {rules.map((r) => (
                <li key={r.id} data-testid="alert-rule" className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-neutral-200">
                  <label className="inline-flex items-center gap-1.5 font-semibold text-white"><input type="checkbox" checked={r.enabled} onChange={(e) => persistRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} aria-label={`${r.name} on or off`} />{r.name}</label>
                  <span className="min-w-0 flex-1 truncate">{r.terms.map((t) => t.text).join(', ')} · {r.scope.kind === 'all' ? 'all covered shows' : `${r.scope.showIds.length} show${r.scope.showIds.length === 1 ? '' : 's'}`}</span>
                  <button type="button" aria-label={`Delete ${r.name}`} className="ck-key ck-key--icon" onClick={() => persistRules(rules.filter((x) => x.id !== r.id))}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}

          {rules.length > 0 && ready && (
            <div data-testid="alert-hits">
              <div className="mb-1 flex items-center gap-2 text-xs text-neutral-300">
                <span data-testid="alert-count">{fresh.length} hit{fresh.length === 1 ? '' : 's'} · {unseen} new{match?.truncated ? ' · showing the newest 300' : ''}</span>
                {unseen > 0 && <button type="button" className="ajr-chip" onClick={() => markSeen(fresh.map((h) => h.id))}>MARK ALL SEEN</button>}
              </div>
              {fresh.length === 0 && <p className="text-xs text-neutral-400" data-testid="alert-none">Nothing in the last {status?.window.days} days matches your alerts.</p>}
              <ul className="m-0 grid list-none gap-2 p-0">{fresh.map((h) => <HitRow key={h.id} h={h} isNew={!seen.has(h.id)} onPlay={play} />)}</ul>
              {library.length > 0 && (
                <div className="mt-2">
                  <button type="button" data-testid="alert-library-toggle" aria-expanded={showLib} className="ajr-chip" onClick={() => setShowLib((v) => !v)}>{showLib ? 'HIDE' : 'SHOW'} {library.length} LIBRARY MATCH{library.length === 1 ? '' : 'ES'} (OLD SHOWS)</button>
                  {showLib && <ul className="m-0 mt-2 grid list-none gap-2 p-0">{library.map((h) => <HitRow key={h.id} h={h} isNew={false} onPlay={play} />)}</ul>}
                </div>
              )}
            </div>
          )}

          {status && (status.state === 'ready' || status.state === 'refreshing') && (
            <div className="text-xs text-neutral-300">
              <button type="button" data-testid="alert-coverage-toggle" aria-expanded={showWho} className="ajr-chip" onClick={() => setShowWho((v) => !v)}>{showWho ? 'HIDE' : 'SHOW'} COVERAGE · {status.covered.length} SHOWS WATCHED · {status.uncovered.length + status.quarantined.length} NOT</button>
              {showWho && (
                <div className="mt-2 grid gap-2" data-testid="alert-coverage">
                  <p className="m-0">Watched ({status.covered.length}): {status.covered.map((s) => s.name).join(', ') || 'none'}.</p>
                  {status.archive.length > 0 && <p className="m-0">Old shows, searchable but never a new alert: {status.archive.map((s) => s.name).join(', ')}.</p>}
                  <p className="m-0">Not covered, because they do not publish transcripts for most episodes ({status.uncovered.length}): {status.uncovered.map((s) => s.name).join(', ') || 'none'}.</p>
                  {status.quarantined.length > 0 && <p className="m-0">Skipped as unreliable: {status.quarantined.map((s) => `${s.name} (${s.reason})`).join('; ')}.</p>}
                  {status.warnings.length > 0 && <p className="m-0">Feed notes: {status.warnings.map((w) => `${w.name}: ${w.warnings.join(' / ')}`).join('; ')}.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HitRow({ h, isNew, onPlay }: { h: AlertHit; isNew: boolean; onPlay: (h: AlertHit) => void }): ReactElement {
  return (
    <li data-testid="alert-hit" className={`flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2 ${isNew ? 'border-amber-300/50 bg-amber-300/10' : 'border-white/10 bg-white/[0.03]'}`}>
      <button type="button" aria-label={`Play ${h.title} from this point`} data-testid="alert-play" onClick={() => onPlay(h)} className="ck-key ck-key--icon h-11 w-11 shrink-0 !rounded-full !text-[#F9A56D]"><Play size={16} fill="currentColor" /></button>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-neutral-400">{isNew && <b className="mr-1 text-amber-200">NEW</b>}{h.showName} · {when(h.publishedAt)} · {h.ruleName}</div>
        <div className="truncate text-sm font-semibold text-white" title={h.title}>{h.title}</div>
        <p className="m-0 mt-0.5 text-sm text-neutral-200" data-testid="alert-snippet">{h.speaker ? <b className="mr-1 text-[10px] uppercase tracking-wide text-emerald-200">{h.speaker}</b> : null}&ldquo;{h.snippet}&rdquo;</p>
        <p className="m-0 mt-0.5 text-[11px] text-neutral-400">Matched {h.matchedTerms.join(', ')} · about {fmtClock(h.cueStart)} in the show, publisher transcript time (ads not counted; it lines up once the audio is playing)</p>
      </div>
    </li>
  );
}
