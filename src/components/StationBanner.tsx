import { useState, type ReactElement } from 'react';
import { stationGradient, type StationTheme } from '../utils/radioAccents';

/** Station logo with an honest emoji fallback; the logo is the station's own image, tinted frame in the channel colour. */
export function StationIcon({ theme, size = 48, className = '' }: { theme: StationTheme; size?: number; className?: string }): ReactElement {
  const [broken, setBroken] = useState(false);
  const frame = { width: size, height: size, borderColor: theme.borderTint, backgroundColor: theme.bgTint, boxShadow: `0 0 12px ${theme.color}40` };
  return (
    <span data-testid="station-icon" style={frame} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border ${className}`}>
      {theme.icon && !broken
        ? <img src={theme.icon} alt="" referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-contain p-0.5" onError={() => setBroken(true)} />
        : <span aria-hidden="true" style={{ fontSize: size * 0.5 }}>{theme.iconEmoji}</span>}
    </span>
  );
}

/** Full-player header for a live radio station: logo, name and a gradient + border in the channel's colours. */
export function StationBanner({ theme, title, subtitle }: { theme: StationTheme; title: string; subtitle?: string }): ReactElement {
  return (
    <div data-testid="station-banner" style={{ background: stationGradient(theme), borderColor: theme.borderTint, boxShadow: `inset 3px 0 0 ${theme.color}` }}
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <StationIcon theme={theme} size={56} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-neutral-50">{title}</p>
        <p className="truncate text-xs" style={{ color: theme.color }}>{subtitle ? `${theme.shortTag} · ${subtitle}` : theme.shortTag}</p>
      </div>
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: theme.bgTint, color: theme.color }}>Live radio</span>
    </div>
  );
}
