import { useEffect, useState, type ReactNode } from 'react';

/** Only same-site paths and https images are drawn: never http (mixed content) or other schemes. */
export function safeLogoUrl(url: string | undefined | null): string | null {
  const u = String(url ?? '').trim();
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return /^https:\/\//i.test(u) ? u : null;
}

/** Channel icon for the guide's station column. Lazy-loaded, never blocks the row: if there is no logo, or it fails to load,
 *  the caller's fallback (the Tv/Radio icon) is shown instead. Light backing so dark-on-transparent logos stay readable. */
export function ChannelLogo({ logo, name, fallback }: { logo?: string | null; name: string; fallback: ReactNode }) {
  const src = safeLogoUrl(logo);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return (
    <span data-testid="channel-logo" className="flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-white/90 px-0.5">
      <img src={src} alt={`${name} logo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain" />
    </span>
  );
}
