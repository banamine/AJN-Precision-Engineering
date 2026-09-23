// Archive links are used exactly as given. The only transformation is dropping
// the https://archive.org origin so the path can go through /api/archive/proxy.
import { buildArchiveProxyUrl } from '../../src/utils/archivePlayback';

const ARCHIVE_DOWNLOAD = /^https?:\/\/(?:www\.)?archive\.org(\/download\/.+)$/i;

/** "/download/..." exactly as it appears in the given URL, or null if not an Archive download link. */
export function archivePathFromUrl(url: string): string | null {
  const m = String(url ?? '').trim().match(ARCHIVE_DOWNLOAD);
  return m ? m[1] : null;
}

/** Proxied playback URL for Archive links; other URLs are returned unchanged. */
export function playableUrl(url: string): { mediaUrl: string; archivePath?: string } {
  const archivePath = archivePathFromUrl(url);
  return archivePath ? { mediaUrl: buildArchiveProxyUrl(archivePath), archivePath } : { mediaUrl: url };
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unsorted';
}
