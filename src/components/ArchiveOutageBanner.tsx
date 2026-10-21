import type { ClientArchiveState } from '../hooks/useArchiveStatus';

const MESSAGES: Partial<Record<ClientArchiveState, string>> = {
  down: 'Archive is offline right now. Archive-hosted shows may not play. Live radio and other sources still work. This resumes automatically.',
  unreachable_from_here: "This server can't reach the internet right now.",
  degraded: 'Archive is slow right now.',
};

export function ArchiveOutageBanner({ state }: { state: ClientArchiveState }) {
  const message = MESSAGES[state];
  if (!message) return null;
  return (
    <div
      role={state === 'down' || state === 'unreachable_from_here' ? 'alert' : 'status'}
      data-testid="archive-outage-banner"
      data-state={state}
      className={`border-t px-4 py-2 text-center text-sm font-medium ${
        state === 'degraded'
          ? 'border-amber-700/60 bg-amber-950/60 text-amber-100'
          : 'border-red-700/60 bg-red-950/70 text-red-100'
      }`}
    >
      {message}
    </div>
  );
}
