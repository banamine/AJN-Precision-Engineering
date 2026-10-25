/** Same-origin English subtitle URL for an Archive video source, or null when the source is not an Archive file. */
export function archiveSubtitleUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, 'https://ajn.invalid');
    let path: string | null = null;
    if (url.pathname === '/api/archive/proxy') path = url.searchParams.get('path');
    else if (url.protocol === 'https:' && /(^|\.)archive\.org$/i.test(url.hostname)) path = decodeURIComponent(url.pathname);
    const m = path ? /^\/download\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/.exec(path) : null;
    if (!m) return null;
    return `/api/archive/subtitles?id=${encodeURIComponent(m[1])}&video=${encodeURIComponent(m[2])}`;
  } catch {
    return null;
  }
}
