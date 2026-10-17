import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Play, RotateCcw, Square } from 'lucide-react';
import { RUMBLE_BASELINE } from '../rumble/baseline';
import { fetchRumbleBaseline } from '../rumble/baselineClient';
import type { RumbleBaseline, RumbleChannel } from '../rumble/types';
import { RESOLVE_FAILURE_TEXT, type ResolvedMedia } from '../news/contract';
import { resolveNewsOnServer } from '../news/client';
import { parseNewsInput } from '../news/registry';
import { chooseBaseline, clearOverride, loadOverride, saveOverride } from '../news/override';
import { handleOfUrl } from '../news/importer';
import { applyPastedVideo } from '../news/pastedVideo';
import { RumbleImportBox } from './RumbleImportBox';
import {
  BACKUP_STREAMS,
  clearWallPicks,
  channelsWithoutVideo,
  duplicateWallChannelNotes,
  embedUrl,
  lastKnownItem,
  listChannelPicks,
  loadWallPicks,
  restoreWallSlots,
  saveWallPicks,
  staleChannelCount,
  type ChannelPick,
  type WallPicks,
  type WallPickStorage,
  type WallSource,
} from '../rumble/wall';

let sessionBaseline: RumbleBaseline | null = null;
let sessionBaselineRequest: ReturnType<typeof fetchRumbleBaseline> | null = null;

function fetchBaselineForSession(): ReturnType<typeof fetchRumbleBaseline> {
  if (sessionBaseline) return Promise.resolve({ changed: false, baseline: sessionBaseline });
  if (sessionBaselineRequest) return sessionBaselineRequest;
  const request = fetchRumbleBaseline().then((result) => {
    const fetched = result.baseline;
    if (fetched && fetched.channels.length > 0 && fetched.items.length > 0) sessionBaseline = fetched;
    return result;
  }).finally(() => { sessionBaselineRequest = null; });
  sessionBaselineRequest = request;
  return request;
}

const NETWORK_LABEL: Record<RumbleChannel['network'], string> = {
  ajn: 'AJN network',
  rav: "Real America's Voice",
  other: 'Other channels',
};

function formatAsOf(iso?: string): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const realClock = () => new Date();
function browserStorage(): WallPickStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Commit a verified link through injected boundaries; baseline and panel writes are independent. */
export function commitResolvedRumblePaste({
  baseline, current, active, media, pageUrl, pastedAt, onApplyBaseline, onChange,
}: {
  baseline: RumbleBaseline;
  current: WallSource;
  active: boolean;
  media: ResolvedMedia;
  pageUrl: string;
  pastedAt: Date;
  onApplyBaseline: (next: RumbleBaseline, resetPanels?: boolean) => boolean;
  onChange: (source: WallSource) => boolean;
}): string {
  const applied = applyPastedVideo(baseline, media, pageUrl, pastedAt);
  const stored = applied.changed ? onApplyBaseline(applied.baseline, false) : true;
  const alreadyShowing = active && current.embedId === media.embedId;
  let message = alreadyShowing
    ? 'Already showing this video'
    : applied.channelId && !applied.changed
      ? `Loaded: ${media.title} (already saved as this channel's latest)`
      : `Loaded: ${media.title}`;
  if (applied.changed || !alreadyShowing) {
    const channel = applied.baseline.channels.find((entry) => entry.id === applied.channelId);
    const item = applied.channelId ? lastKnownItem(applied.baseline, applied.channelId) : null;
    const savedPanel = onChange({
      key: `${applied.channelId ?? 'link'}:${media.embedId}`,
      embedId: media.embedId,
      label: channel?.name ?? media.author ?? 'Rumble video',
      detail: media.title,
      ...(applied.channelId ? { channelId: applied.channelId } : {}),
      ...(item ? { asOf: item.seenAt ?? applied.baseline.generatedAt } : {}),
      pastedAt: pastedAt.toISOString(),
      pageUrl,
      resolved: true,
    });
    if (!savedPanel) message += ' Panel pick storage failed; loaded for this visit only.';
  }
  if (!stored) message += ' Baseline storage failed; the browser could not save this channel update.';
  if (!applied.channelId) message += ' No matching channel in the list; the baseline was not changed.';
  return message;
}

export function RumbleWallStatus({ message }: { message: string }) {
  return <p className="text-[11px] text-neutral-300" role="status" aria-live="polite" data-testid="rumble-panel-status">{message}</p>;
}

function formatViewers(viewers?: number): string | null {
  if (!viewers) return null;
  return viewers >= 1000 ? `${(viewers / 1000).toFixed(viewers >= 10000 ? 0 : 1)}K` : String(viewers);
}

interface PanelProps {
  source: WallSource;
  picks: ChannelPick[];
  missing: RumbleChannel[];
  active: boolean;
  focused: boolean;
  onChange: (source: WallSource) => boolean;
  onActivate: () => void;
  onToggleFocus: () => void;
  getBaseline: () => RumbleBaseline;
  onApplyBaseline: (next: RumbleBaseline, resetPanels?: boolean) => boolean;
  clock: () => Date;
}

function WallPanel({ source, picks, missing, active, focused, onChange, onActivate, onToggleFocus, getBaseline, onApplyBaseline, clock }: PanelProps) {
  const [custom, setCustom] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState(source.pastedAt ? 'Restored saved panel pick.' : 'Paste a video link and press Go.');
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const activeRef = useRef(active);
  activeRef.current = active;
  const token = useRef(0);
  useEffect(() => () => { token.current += 1; }, []);

  const pickIds = useMemo(() => new Set(picks.map((pick) => pick.channelId)), [picks]);
  const selectValue =
    source.channelId && pickIds.has(source.channelId)
      ? source.channelId
      : source.backup && BACKUP_STREAMS.some((backup) => backup.embedId === source.embedId)
        ? `backup:${source.embedId}`
        : '__custom';
  const viewers = formatViewers(source.viewers);
  const asOf = formatAsOf(source.asOf);
  const pastedTime = formatAsOf(source.pastedAt);

  const loadSource = (next: WallSource, message: string) => {
    const stored = onChange(next);
    setStatus(stored ? message : `${message} Panel pick storage failed; loaded for this visit only.`);
  };

  /** One path for typed/pasted text AND for a channel pick (which pastes its last known link). */
  const applyInput = async (text: string, pick?: ChannelPick) => {
    const mine = ++token.current;
    setBusy(false);
    setProblem(null);
    const parsed = parseNewsInput(text);
    if (!parsed) {
      const reason = handleOfUrl(text.trim())
        ? "That is a channel page. Open a video on it and paste that video's link."
        : `${RESOLVE_FAILURE_TEXT['invalid-input']} Paste a Rumble video link (https://rumble.com/v…-title.html) or an embed ID.`;
      setProblem(`${reason} Still showing the previous video.`);
      setStatus('No new video loaded.');
      return;
    }
    const pastedAt = clock();
    if (parsed.kind !== 'page') {
      // Embed id / embed URL: nothing to look up, load it as before.
      setCustom('');
      if (sourceRef.current.embedId === parsed.id && activeRef.current) {
        setStatus('Already showing this video');
        return;
      }
      loadSource({
        key: `custom-${parsed.id}`, embedId: parsed.id, label: 'Custom embed',
        detail: parsed.id, backup: true, pastedAt: pastedAt.toISOString(),
      }, `Loaded: ${parsed.id} (embed ID; not looked up).`);
      return;
    }
    setBusy(true);
    setStatus('Looking up this video…');
    const result = await resolveNewsOnServer(parsed.pageUrl ?? text);
    if (mine !== token.current) return;
    setBusy(false);
    if ('media' in result) {
      const media: ResolvedMedia = result.media;
      try {
        if (!pick) {
          setStatus(commitResolvedRumblePaste({
            baseline: getBaseline(), current: sourceRef.current, active: activeRef.current,
            media, pageUrl: parsed.pageUrl ?? text, pastedAt, onApplyBaseline, onChange,
          }));
          setCustom('');
          return;
        }
      } catch (error) {
        setProblem(`${error instanceof Error ? error.message : String(error)} Still showing the previous video.`);
        setStatus('No new video loaded.');
        return;
      }
      if (sourceRef.current.embedId === media.embedId && activeRef.current) {
        setStatus('Already showing this video');
        return;
      }
      loadSource({
        key: `${pick.channelId}:${media.embedId}`,
        embedId: media.embedId,
        label: pick.label,
        detail: media.title,
        channelId: pick.channelId,
        asOf: pick.asOf,
        viewers: pick.state === 'live' ? pick.viewers ?? undefined : undefined,
        pinned: pick.channelId === 'news-rt',
        pageUrl: parsed.pageUrl ?? text,
        resolved: true,
      }, `Loaded: ${media.title} (resolved ${formatAsOf(media.resolvedAt) ?? media.resolvedAt})`);
      return;
    }
    if (pick) {
      // Lookup failed: use the stored id from the last import, clearly marked unverified.
      setProblem(`${RESOLVE_FAILURE_TEXT[result.reason]} Showing the video stored at the last import (unverified).`);
      loadSource({
        key: `${pick.channelId}:${pick.embedId}`,
        embedId: pick.embedId,
        label: pick.label,
        detail: pick.title,
        channelId: pick.channelId,
        asOf: pick.asOf,
        viewers: pick.state === 'live' ? pick.viewers ?? undefined : undefined,
        unverified: true,
        pinned: pick.channelId === 'news-rt',
      }, 'Loaded the stored video (unverified).');
      return;
    }
    setProblem(`${RESOLVE_FAILURE_TEXT[result.reason]} Still showing the previous video.`);
    setStatus('No new video loaded.');
  };

  const onSelect = (value: string) => {
    if (value.startsWith('backup:')) {
      const backup = BACKUP_STREAMS.find((entry) => entry.embedId === value.slice('backup:'.length));
      if (backup) {
        token.current += 1;
        setBusy(false);
        setProblem(null);
        if (sourceRef.current.embedId === backup.embedId && activeRef.current) setStatus('Already showing this video');
        else loadSource(backup, `Loaded: ${backup.label} (backup embed).`);
      }
      return;
    }
    const pick = picks.find((entry) => entry.channelId === value);
    if (!pick) return;
    setCustom(pick.pageUrl); // same as the user pasting that link...
    void applyInput(pick.pageUrl, pick); // ...and pressing Go
  };

  // The channel's Rumble page (from the channel list), opened in a NEW tab so the viewer can copy the newest video link.
  const channelPageUrl = (() => {
    const url = getBaseline().channels.find((c) => c.id === source.channelId)?.url;
    return url && /^https:\/\/rumble\.com\/(c|user)\/[A-Za-z0-9_.-]+\/?$/.test(url) ? url : null;
  })();
  /** Paste whatever link is on the clipboard and press Go for the viewer. Needs the browser's clipboard permission. */
  const pasteAndGo = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) { setStatus('The clipboard is empty. Copy a Rumble video link first.'); return; }
      setCustom(text);
      await applyInput(text);
    } catch {
      setStatus('The browser did not allow clipboard access. Paste the link with Ctrl+V and press Go.');
    }
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
        {source.unverified && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono uppercase text-amber-300" title="Lookup failed; this is the id stored at the last import">unverified</span>
        )}
        {pastedTime ? (
          <span className="shrink-0 font-mono text-[10px] text-neutral-500" data-testid="rumble-pasted-label">
            link pasted <time dateTime={source.pastedAt}>{pastedTime}</time>
          </span>
        ) : asOf && (
          <span className="shrink-0 font-mono text-[10px] text-neutral-500" title="When the list this pick came from was imported">as of {asOf}</span>
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
        {active && source.embedId ? (
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
            disabled={!source.embedId}
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
            value={selectValue}
            onChange={(event) => onSelect(event.target.value)}
            disabled={busy}
            aria-label={`Channel for ${source.label}`}
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {selectValue === '__custom' && <option value="__custom">{source.label}</option>}
            {(['ajn', 'rav', 'other'] as const).map((network) => {
              const group = picks.filter((pick) => pick.network === network);
              if (group.length === 0) return null;
              return (
                <optgroup key={network} label={NETWORK_LABEL[network]}>
                  {group.map((pick) => (
                    <option key={pick.channelId} value={pick.channelId}>
                      {pick.label} — {pick.state === 'live' ? `LIVE${pick.viewers ? ` ${formatViewers(pick.viewers)}` : ''}` : 'last video'}{formatAsOf(pick.asOf) ? ` — as of ${formatAsOf(pick.asOf)}` : ''}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            {missing.length > 0 && (
              <optgroup label="No known video yet (needs an import)">
                {missing.map((channel) => (
                  <option key={channel.id} value={`missing:${channel.id}`} disabled>{channel.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Backups (embed id only)">
              {BACKUP_STREAMS.map((backup) => (
                <option key={backup.key} value={`backup:${backup.embedId}`}>{backup.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void applyInput(custom);
          }}
        >
          <input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              token.current += 1;
              setBusy(false);
              setProblem(null);
              setStatus('Paste a video link and press Go.');
            }}
            placeholder="Paste a Rumble video link or embed ID"
            aria-label={`Video link for ${source.label}`}
            aria-invalid={problem !== null}
            className={`min-w-0 flex-1 rounded-md border bg-neutral-950 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              problem ? 'border-red-500' : 'border-neutral-700'
            }`}
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {busy ? '…' : 'Go'}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {channelPageUrl && (
            <a
              href={channelPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="rumble-open-channel"
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-sky-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              title="Opens this channel on Rumble in a new tab. Copy the newest video's link, come back and press Paste & Go."
            >
              Open channel on Rumble ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => void pasteAndGo()}
            data-testid="rumble-paste-go"
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            title="Pastes the link you copied from Rumble and loads it"
          >
            Paste &amp; Go
          </button>
        </div>
        <RumbleWallStatus message={status} />
        {problem && (
          <p className="text-[11px] text-red-400" role="alert">{problem}</p>
        )}
      </footer>
    </section>
  );
}

interface RumbleNewsWallProps {
  storage?: WallPickStorage | null;
  clock?: () => Date;
  initialBaseline?: RumbleBaseline;
}

export function RumbleNewsWall({
  storage = browserStorage(),
  clock = realClock,
  initialBaseline = RUMBLE_BASELINE,
}: RumbleNewsWallProps = {}) {
  const [initial] = useState(() => {
    const saved = loadOverride(storage);
    const baseline = chooseBaseline([initialBaseline, saved]);
    const loaded = loadWallPicks(storage);
    return { saved, baseline, picks: loaded.picks, slots: restoreWallSlots(baseline, loaded.picks, clock().getTime()), error: loaded.error };
  });
  const [saved, setSaved] = useState<RumbleBaseline | null>(initial.saved);
  const [baseline, setBaseline] = useState<RumbleBaseline>(initial.baseline);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const [slots, setSlots] = useState<WallSource[]>(initial.slots);
  const savedPicksRef = useRef<WallPicks>(initial.picks);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const [active, setActive] = useState<boolean[]>([true, true, true, true]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const touched = useRef(false);

  // Prefer the server's list when it answers, unless the list saved in this browser is newer.
  useEffect(() => {
    let cancelled = false;
    void fetchBaselineForSession().then(({ baseline: fetched }) => {
      if (cancelled || !fetched) return;
      const chosen = chooseBaseline([baselineRef.current, initialBaseline, fetched, loadOverride(storage)]);
      baselineRef.current = chosen;
      setBaseline(chosen);
      if (!touched.current) setSlots(restoreWallSlots(chosen, savedPicksRef.current, clock().getTime()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyImported = (next: RumbleBaseline, resetPanels = true): boolean => {
    const stored = saveOverride(next, storage);
    setSaved(stored ? next : null);
    baselineRef.current = next;
    setBaseline(next);
    if (resetPanels && !touched.current) {
      setSlots(restoreWallSlots(next, savedPicksRef.current, clock().getTime()));
      setActive([true, true, true, true]);
    }
    return stored;
  };

  const resetSaved = () => {
    clearOverride(storage);
    setSaved(null);
    const builtIn = chooseBaseline([initialBaseline]);
    baselineRef.current = builtIn;
    setBaseline(builtIn);
    if (!touched.current) setSlots(restoreWallSlots(builtIn, savedPicksRef.current, clock().getTime()));
  };

  const picks = useMemo(() => listChannelPicks(baseline), [baseline]);
  const missing = useMemo(() => channelsWithoutVideo(baseline), [baseline]);
  const staleCount = staleChannelCount(picks, clock().getTime());
  const duplicateNotes = duplicateWallChannelNotes(slots);
  const anyActive = active.some(Boolean);
  const visible = focusIndex === null ? slots.map((_, index) => index) : [focusIndex];

  const updateSlot = (index: number, source: WallSource): boolean => {
    touched.current = true;
    setSlots((current) => current.map((slot, i) => (i === index ? source : slot)));
    setActive((current) => current.map((flag, i) => (i === index ? true : flag)));
    savedPicksRef.current = savedPicksRef.current.map((pick, i) => i === index ? source : pick);
    const result = saveWallPicks(savedPicksRef.current, storage);
    setStorageError(result.error);
    return result.ok;
  };

  const reset = () => {
    touched.current = false;
    savedPicksRef.current = [null, null, null, null];
    const result = clearWallPicks(storage);
    setStorageError(result.error);
    setSlots(restoreWallSlots(baseline, savedPicksRef.current, clock().getTime()));
    setActive([true, true, true, true]);
    setFocusIndex(null);
  };

  return (
    <div className="w-full pb-24 md:pb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">News Wall</h1>
          <p className="text-xs text-neutral-400">
            RT News 24/7 is pinned in the default wall; saved picks stay in their panels. Other default panels use the highest-viewer live streams from the last import
            ({new Date(baseline.generatedAt).toLocaleString()}). Viewer counts are a snapshot, and a stream may
            have ended since. Pick a channel in any panel: its last known video link is pasted for you and
            looked up. You can also paste any Rumble video link. Press play inside a panel to start it.
          </p>
          {staleCount > 0 && (
            <p className="mt-1 text-xs text-amber-300" role="status">
              {staleCount} of {picks.length} channel{picks.length === 1 ? '' : 's'} were last read more than a day ago. Newer
              videos are not shown until you update the list (bottom of this page); paste a link to play a newer one now.
            </p>
          )}
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

      {storageError && (
        <div className="mb-3 text-amber-300" data-testid="rumble-storage-status">
          <RumbleWallStatus message={storageError} />
        </div>
      )}
      {duplicateNotes.map((note, index) => (
        <p key={index} className="mb-2 text-xs text-amber-300" role="status" data-testid="rumble-duplicate-note">{note}</p>
      ))}
      <div className={focusIndex === null ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : 'grid grid-cols-1 gap-4'}>
        {visible.map((index) => (
          <div key={index} className="min-w-0">
          <WallPanel
            source={slots[index]}
            picks={picks}
            missing={missing}
            active={active[index]}
            focused={focusIndex === index}
            onChange={(source) => updateSlot(index, source)}
            onActivate={() => setActive((current) => current.map((flag, i) => (i === index ? true : flag)))}
            onToggleFocus={() => setFocusIndex(focusIndex === index ? null : index)}
            getBaseline={() => baselineRef.current}
            onApplyBaseline={applyImported}
            clock={clock}
          />
          </div>
        ))}
      </div>

      <RumbleImportBox
        baseline={baseline}
        hasSavedList={saved !== null}
        onApply={applyImported}
        onResetSaved={resetSaved}
      />
    </div>
  );
}
