# Run from the repo root: python apply-edits.py   (idempotent: a second run says "already applied")
import pathlib
def edit(path, edits, marker):
    p = pathlib.Path(path); s = p.read_text(encoding='utf-8')
    if marker in s: print('already applied:', path); return
    for a, b in edits: assert s.count(a) == 1, 'anchor not found / not unique in ' + path + ': stop: ' + a[:70]
    for a, b in edits: s = s.replace(a, b)
    p.write_text(s, encoding='utf-8'); print('applied', len(edits), 'edits to', path)

# ---- shared hook: skip() + isPodcastOnDemand, so the dock and the full player use one rule ----
edit('src/hooks/usePersistentMedia.ts', [
("import type { MediaType } from '../types';",
 "import type { MediaType } from '../types';\nimport { isPodcastOnDemand as podcastOnDemand, skipMedia, type PodcastItemLike } from '../utils/podcastSkip';"),
("  toggleMute: () => void;\n}",
 "  toggleMute: () => void;\n  /** Move the playhead by this many seconds (negative = back). Rapid taps stack. */\n  skip: (deltaSeconds: number) => void;\n  /** True only for an on-demand podcast episode with a known length (never live radio or the 24/7 stack). */\n  isPodcastOnDemand: boolean;\n}"),
("sourceKey: string | undefined, enabled = true): PersistentMedia {",
 "sourceKey: string | undefined, enabled = true, item?: PodcastItemLike | null): PersistentMedia {"),
("  return { ...state, toggle, seek, toggleMute };",
 "  const skip = useCallback((deltaSeconds: number) => {\n    const media = mediaRef.current ?? findPersistentMedia(mediaType);\n    if (media) skipMedia(media, deltaSeconds);\n  }, [mediaType]);\n  return { ...state, toggle, seek, toggleMute, skip, isPodcastOnDemand: podcastOnDemand(item, state.duration) };"),
], 'podcastSkip')

# ---- full player: +15s / +30s / +1m row under the transport ----
edit('src/components/PlayerChrome.tsx', [
('import { cleanArchiveMusicFilename } from "../utils/archiveMusicTitle";',
 'import { cleanArchiveMusicFilename } from "../utils/archiveMusicTitle";\nimport { SKIP_FORWARD_SECONDS, isPodcastOnDemand, skipAriaLabel, skipLabel, skipMedia, type PodcastItemLike } from "../utils/podcastSkip";'),
("  isFavorite?: boolean;\n  onToggleFavorite?: () => void;\n}",
 "  isFavorite?: boolean;\n  onToggleFavorite?: () => void;\n  /** What is playing; the podcast skip row shows only for an on-demand podcast episode (see utils/podcastSkip.ts). */\n  podcastItem?: PodcastItemLike | null;\n}"),
("  const noDuration = !(Number.isFinite(time.d) && time.d > 0);",
 "  const noDuration = !(Number.isFinite(time.d) && time.d > 0);\n  const podcastOnDemand = isPodcastOnDemand(p.podcastItem, time.d);\n  const skipPodcast = (seconds: number) => { const m = p.mediaRef.current; if (m) skipMedia(m, seconds); };"),
("      {/* seek row: elapsed — bar — total */}",
 """      {podcastOnDemand && (
        <div data-testid="podcast-skip" role="group" aria-label="Skip ahead" className="mt-1 flex items-center justify-center gap-2">
          {SKIP_FORWARD_SECONDS.map((sec) => (
            <button key={sec} type="button" data-testid={`podcast-skip-${sec}`} onClick={() => skipPodcast(sec)} aria-label={skipAriaLabel(sec)} title={skipAriaLabel(sec)}
              className="flex h-11 min-w-[56px] items-center justify-center rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-neutral-100 transition hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              {skipLabel(sec)}
            </button>
          ))}
        </div>
      )}
      {/* seek row: elapsed — bar — total */}"""),
], 'podcast-skip')

# ---- MinimalPlayer: hand the player what is playing ----
edit('src/MinimalPlayer.tsx', [
("        isFavorite={isFavorite}\n        onToggleFavorite={onToggleFavorite}\n      />",
 "        isFavorite={isFavorite}\n        onToggleFavorite={onToggleFavorite}\n        podcastItem={nowPlaying}\n      />"),
], 'podcastItem={nowPlaying}')

# ---- bottom dock: -15s and +30s (inline on desktop; their own row on a phone, like the radio Prev/Next row) ----
edit('src/components/MiniPlayerDock.tsx', [
("import { RumbleLiveBadge } from './RumbleLiveBadge';",
 "import { RumbleLiveBadge } from './RumbleLiveBadge';\nimport { DOCK_SKIP_BACK_SECONDS, DOCK_SKIP_FORWARD_SECONDS, skipAriaLabel, skipLabel } from '../utils/podcastSkip';"),
("  const { paused, muted, currentTime, duration, toggle: togglePlay, toggleMute, seek } =\n    usePersistentMedia(nowPlaying.mediaType, `${nowPlaying.src}|${nowPlaying.mediaType}`);",
 "  const { paused, muted, currentTime, duration, toggle: togglePlay, toggleMute, seek, skip, isPodcastOnDemand } =\n    usePersistentMedia(nowPlaying.mediaType, `${nowPlaying.src}|${nowPlaying.mediaType}`, true, nowPlaying);"),
("        <button\n          type=\"button\"\n          id=\"mini-player-toggle-btn\"",
 """        {isPodcastOnDemand && (
          <button type="button" data-testid="dock-skip-back" aria-label={skipAriaLabel(-DOCK_SKIP_BACK_SECONDS)} title={skipAriaLabel(-DOCK_SKIP_BACK_SECONDS)} onClick={() => skip(-DOCK_SKIP_BACK_SECONDS)} style={{ minWidth: '48px', minHeight: '48px' }}
            className="ajn-dock-control hidden h-12 w-12 !min-h-[48px] !min-w-[48px] shrink-0 items-center justify-center rounded-full border border-[var(--ajn-line)] text-[11px] font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation md:flex">
            {skipLabel(-DOCK_SKIP_BACK_SECONDS)}
          </button>
        )}
        <button
          type="button"
          id="mini-player-toggle-btn\""""),
("        {isRadio && (\n          <button type=\"button\" data-testid=\"dock-next-round\"",
 """        {isPodcastOnDemand && (
          <button type="button" data-testid="dock-skip-forward" aria-label={skipAriaLabel(DOCK_SKIP_FORWARD_SECONDS)} title={skipAriaLabel(DOCK_SKIP_FORWARD_SECONDS)} onClick={() => skip(DOCK_SKIP_FORWARD_SECONDS)} style={{ minWidth: '48px', minHeight: '48px' }}
            className="ajn-dock-control hidden h-12 w-12 !min-h-[48px] !min-w-[48px] shrink-0 items-center justify-center rounded-full border border-[var(--ajn-line)] text-[11px] font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation md:flex">
            {skipLabel(DOCK_SKIP_FORWARD_SECONDS)}
          </button>
        )}
        {isRadio && (
          <button type="button" data-testid="dock-next-round\""""),
("      {isRadio && (\n        <div data-testid=\"dock-stepper\"",
 """      {isPodcastOnDemand && (
        <div data-testid="dock-skip-row" className="flex w-full basis-full items-center gap-2 px-1 pb-1 md:hidden">
          <button type="button" data-testid="dock-skip-back-phone" aria-label={skipAriaLabel(-DOCK_SKIP_BACK_SECONDS)} onClick={() => skip(-DOCK_SKIP_BACK_SECONDS)} style={{ minWidth: '48px', minHeight: '48px' }}
            className="ajn-dock-control flex h-12 !min-h-[48px] flex-1 items-center justify-center rounded-lg border border-[var(--ajn-line)] bg-[var(--ajn-card-2)] text-xs font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation">
            {skipLabel(-DOCK_SKIP_BACK_SECONDS)}
          </button>
          <button type="button" data-testid="dock-skip-forward-phone" aria-label={skipAriaLabel(DOCK_SKIP_FORWARD_SECONDS)} onClick={() => skip(DOCK_SKIP_FORWARD_SECONDS)} style={{ minWidth: '48px', minHeight: '48px' }}
            className="ajn-dock-control flex h-12 !min-h-[48px] flex-1 items-center justify-center rounded-lg border border-[var(--ajn-line)] bg-[var(--ajn-card-2)] text-xs font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation">
            {skipLabel(DOCK_SKIP_FORWARD_SECONDS)}
          </button>
        </div>
      )}
      {isRadio && (
        <div data-testid="dock-stepper\""""),
], 'dock-skip-row')
