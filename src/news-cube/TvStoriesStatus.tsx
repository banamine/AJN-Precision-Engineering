import type { TvStoriesPayload } from './useTvStories';

const label = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'n/a');

/** One inline status line for the TV caption stories on Face 6. Backoffs (no-text / cooldown) are listed inline. */
export default function TvStoriesStatus({ payload, error, loading }: { payload: TvStoriesPayload | null; error: string | null; loading: boolean }) {
  if (loading && !payload) return <p role="status" className="text-sm text-neutral-400">Loading TV caption stories…</p>;
  if (!payload) return error ? <p role="alert" className="text-sm text-amber-300">TV caption stories unavailable: {error}</p> : null;
  const active = payload.networks.filter((n) => n.cards > 0).length;
  const skipped = payload.networks.filter((n) => n.status === 'no-text' || n.status === 'cooldown');
  const w = payload.window;
  const line = `TV stories: ${payload.stories.length} from ${active} networks, covering ${label(w.coveredFromUtc)} to ${label(w.coveredToUtc)}${w.building ? ' (building)' : ''}`;
  return (
    <div role="status" className="text-xs text-neutral-400">
      <p>{line}</p>
      {skipped.length > 0 && <p>{skipped.map((n) => `${n.network}: ${n.status === 'no-text' ? 'no caption text' : 'paused (rate limit)'}`).join(' · ')}</p>}
      {error && <p className="text-amber-300">Last refresh failed: {error}</p>}
    </div>
  );
}
