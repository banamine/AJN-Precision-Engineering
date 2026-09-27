const ARCHIVE_DOWNLOAD_PREFIX = '/download/';

export function buildArchiveProxyUrl(archivePath: string): string {
  const path = String(archivePath ?? '').trim();
  if (!path.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
    throw new Error('Archive playback requires a canonical /download/ path');
  }
  return `/api/archive/proxy?path=${encodeURIComponent(path)}`;
}
