/** Narrow proxy-only correction for Archive's octet-stream audio responses. */
export function archiveProxyContentType(path: string, upstream: string | null): string | null {
  if (!upstream || !/^application\/octet-stream(?:\s*;|$)/i.test(upstream)) return upstream;
  const cleanPath = path.split(/[?#]/, 1)[0].toLowerCase();
  if (cleanPath.endsWith('.m4a')) return 'audio/mp4';
  if (cleanPath.endsWith('.aac')) return 'audio/aac';
  return upstream;
}
