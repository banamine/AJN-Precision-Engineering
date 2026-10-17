import { useEffect, useState, type ReactElement } from 'react';

interface LiveRadioBadgeProps {
  /** Whether the directory panel under the guide is open. */
  open: boolean;
  onToggle: () => void;
}

interface LiveRadioStatusResponse {
  stations: number;
  enabled: number;
  rejected: Array<{ id: string; reason: string }>;
}

export function LiveRadioBadge({ open, onToggle }: LiveRadioBadgeProps): ReactElement {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [status, setStatus] = useState<LiveRadioStatusResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/live-radio/status')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LiveRadioStatusResponse>;
      })
      .then((data) => {
        if (active) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-neutral-700/60 bg-neutral-800/40 text-neutral-400">
        Live Radio: status unavailable
      </span>
    );
  }

  if (loading || !status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-neutral-700/60 bg-neutral-800/40 text-neutral-400 animate-pulse">
        Live Radio · loading…
      </span>
    );
  }

  if (status.enabled === 0) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-neutral-800 bg-neutral-900/60 text-neutral-500 cursor-not-allowed"
      >
        Live Radio · 0 stations loaded yet (US + Canada coming)
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="live-radio-directory"
      data-testid="live-radio-toggle"
      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        open ? 'border-amber-400/70 bg-amber-500/20 text-amber-100' : 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'}`}
    >
      <span>Live Radio · {status.enabled.toLocaleString()} stations, US + Canada</span>
      <span className="text-xs text-amber-300/80">{open ? 'Hide ▴' : 'Browse ▾'}</span>
    </button>
  );
}
