/** Narrow proxy-only correction for Archive's octet-stream audio responses. */
import { archiveUpstreamPathname } from './archivePathEncoding';

export function archiveProxyContentType(path: string, upstream: string | null): string | null {
  if (!upstream || !/^application\/octet-stream(?:\s*;|$)/i.test(upstream)) return upstream;
  let cleanPath: string;
  try {
    cleanPath = archiveUpstreamPathname(path).toLowerCase();
  } catch {
    return upstream;
  }
  // Keep legacy query-string behavior for normal names such as a.aac?x=1,
  // while the canonical URL path correctly handles encoded '?' in filenames.
  const legacyPath = path.split(/[?#]/, 1)[0].toLowerCase();
  if (cleanPath.endsWith('.m4a') || legacyPath.endsWith('.m4a')) return 'audio/mp4';
  if (cleanPath.endsWith('.aac') || legacyPath.endsWith('.aac')) return 'audio/aac';
  return upstream;
}
