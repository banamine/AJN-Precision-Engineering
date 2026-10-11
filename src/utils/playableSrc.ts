const ARCHIVE_PROXY_BASE = '/api/archive/proxy?path=';
const ARCHIVE_DOWNLOAD_PREFIX = '/download/';

/** Resolve a media reference to exactly one playable transport URL. */
export function toPlayableSrc(rawPath: string): string {
  const value = String(rawPath ?? '').trim();
  if (!value) return value;
  if (value.startsWith(ARCHIVE_PROXY_BASE)) return value;

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.pathname === '/api/archive/proxy' && parsed.searchParams.has('path')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
      const archivePath = `${parsed.pathname}${parsed.search}`;
      return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(archivePath)}`;
    }
  } catch {
    // Preserve non-URL references unchanged below.
  }

  if (value.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
    return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(value)}`;
  }
  return value;
}
