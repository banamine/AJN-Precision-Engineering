import data from '../../src/data/mkvCodecVerified.json';

export interface MkvVerifiedEntry {
  md5?: string;
  size?: number;
  length?: number | null;
  status: 'verified' | 'unverified';
  browserPlayable: boolean;
  videoNorm?: string;
  audioNorm?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioTracks?: number;
  hasCues: boolean;
  reason?: string;
  probedAt?: string;
}

let mockVerifiedTable: Record<string, MkvVerifiedEntry> | null = null;

export function setMockVerifiedData(table: Record<string, MkvVerifiedEntry> | null): void {
  mockVerifiedTable = table;
}

/**
 * Returns "/download/<id>/<name>" with every path segment decoded.
 * Unwraps "/api/archive/proxy?path=" and "https://archive.org" prefixes.
 * Returns null if not an Archive download path. Keeps case as-is.
 */
export function archiveKey(pathOrUrl: string | undefined): string | null {
  if (!pathOrUrl) return null;
  let s = String(pathOrUrl).trim();

  // Strip full URL origin if archive.org or relative proxy
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      s = u.pathname + u.search;
    } catch {
      // keep
    }
  }

  // Unwrap /api/archive/proxy?path=
  if (s.startsWith('/api/archive/proxy')) {
    try {
      const u = new URL(s, 'http://localhost');
      s = u.searchParams.get('path') || '';
    } catch {
      // keep
    }
  }

  // Strip query and hash
  s = s.split(/[?#]/)[0];

  if (!s.startsWith('/download/')) {
    const idx = s.indexOf('/download/');
    if (idx !== -1) {
      s = s.slice(idx);
    } else {
      return null;
    }
  }

  const parts = s.split('/');
  if (parts.length < 4 || parts[1] !== 'download') return null;

  const decodedParts = parts.map((seg, i) => {
    if (i < 2) return seg;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });

  return decodedParts.join('/');
}

/**
 * null when entry exists AND status==="verified" AND browserPlayable && hasCues.
 * Otherwise returns a rejection or unverified reason string.
 */
export function mkvVerdict(pathOrUrl: string | undefined): null | string {
  const key = archiveKey(pathOrUrl);
  if (!key) return '.mkv not yet codec-verified';

  const table: Record<string, MkvVerifiedEntry> =
    mockVerifiedTable || ((data as any)?.files as Record<string, MkvVerifiedEntry>) || {};

  const entry = table[key];
  if (!entry) return '.mkv not yet codec-verified';

  if (entry.status !== 'verified') {
    return entry.reason ? `.mkv rejected: ${entry.reason}` : '.mkv not yet codec-verified';
  }

  if (!entry.browserPlayable) {
    return entry.reason ? `.mkv rejected: ${entry.reason}` : '.mkv rejected: unplayable codec';
  }

  if (!entry.hasCues) {
    return '.mkv has no seek index (Cues)';
  }

  return null;
}
