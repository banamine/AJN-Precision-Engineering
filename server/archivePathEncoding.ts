const ARCHIVE_ORIGIN = 'https://archive.org';

export interface ArchivePathValidation {
  valid: boolean;
  cleanPath?: string;
  error?: string;
}

const CLIP_QUERY_PATTERNS = [
  /^(?:exact=1&)?start=\d+&end=\d+(?:&ignore=[A-Za-z0-9_.-]+)?$/,
  /^t=\d+\/\d+&ignore=[A-Za-z0-9_.-]+$/,
];

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeSegment(segment: string): string {
  // cleanPath is decoded. Re-decode valid percent escapes from callers that
  // supplied a pre-encoded value, then encode the segment once for the URL.
  return encodeURIComponent(decodeSegment(segment));
}

function splitClipQuery(path: string): { pathname: string; query: string } {
  // Search from the end so a filename containing '?' can precede a recognized
  // clip query without becoming ambiguous in the canonical decoded path.
  for (let queryAt = path.lastIndexOf('?'); queryAt >= 0; queryAt = path.lastIndexOf('?', queryAt - 1)) {
    const candidate = path.slice(queryAt + 1);
    if (CLIP_QUERY_PATTERNS.some((pattern) => pattern.test(candidate))) {
      return { pathname: path.slice(0, queryAt), query: `?${candidate}` };
    }
  }
  return { pathname: path, query: '' };
}

function canonicalizePath(raw: string): ArchivePathValidation {
  if (!raw || typeof raw !== 'string') return { valid: false, error: 'Path is required' };
  if (!raw.startsWith('/')) return { valid: false, error: 'Path must begin with a forward slash (/)' };
  if (raw.startsWith('/api/archive/proxy')) return { valid: false, error: 'Nested archive proxy paths are forbidden' };
  if (/^https?:\/\//i.test(raw) || raw.includes('://')) {
    return { valid: false, error: 'Embedded schemes/hosts are forbidden' };
  }
  if (raw.includes('\\')) return { valid: false, error: 'Directory traversal sequences are forbidden' };

  const { pathname: inputPath, query } = splitClipQuery(raw);
  const cdnMatch = inputPath.match(/^\/\d+\/items\/([^/?#]+)(\/.*)$/);
  const archivePath = cdnMatch
    ? `/download/${cdnMatch[1]}${cdnMatch[2]}`
    : inputPath;
  if (!archivePath.startsWith('/download/')) {
    return { valid: false, error: 'Only Archive.org /download paths are permitted' };
  }

  const segments = archivePath.slice(1).split('/');
  if (segments.length < 3 || segments[0] !== 'download' || !segments[1]) {
    return { valid: false, error: 'Archive download identifier and file path are required' };
  }

  const identifier = decodeSegment(segments[1]);
  if (!identifier || identifier === '.' || identifier === '..'
    || identifier.includes('/') || identifier.includes('\\')
    || /^https?:/i.test(identifier)) {
    return { valid: false, error: 'Invalid Archive identifier' };
  }

  const fileSegments = segments.slice(2);
  if (fileSegments.some((segment) => {
    const decoded = decodeSegment(segment);
    return segment === '.' || segment === '..'
      || decoded === '.' || decoded === '..'
      || decoded.includes('/') || decoded.includes('\\');
  })) {
    return { valid: false, error: 'Directory traversal sequences are forbidden' };
  }

  // cleanPath is deliberately decoded and stable: it is the key used by the
  // health recorder, caches, failure memoization, and read-ahead bookkeeping.
  // URL delimiters are escaped only when constructing the upstream URL.
  return {
    valid: true,
    cleanPath: `/download/${segments[1]}/${fileSegments.map(decodeSegment).join('/')}${query}`,
  };
}

/** Validate and canonicalize an Archive path without converting it to a URL. */
export function validateArchivePath(raw: string): ArchivePathValidation {
  return canonicalizePath(raw);
}

/**
 * Convert a validated canonical Archive path to an upstream URL.
 *
 * URL-significant filename characters are encoded per segment. Only the
 * established bounded-clip query forms remain query parameters; any other `?`
 * is treated as part of the filename.
 */
export function toArchiveUpstreamUrl(cleanPath: string): string {
  const checked = canonicalizePath(cleanPath);
  if (!checked.valid || !checked.cleanPath) {
    throw new Error(checked.error || 'Invalid Archive path');
  }
  const { pathname, query } = splitClipQuery(checked.cleanPath);
  const segments = pathname.slice(1).split('/');
  const encodedPath = `/${segments[0]}/${segments[1]}/${segments.slice(2).map(encodeSegment).join('/')}`;
  const url = new URL(`${encodedPath}${query}`, ARCHIVE_ORIGIN);
  if (url.origin !== ARCHIVE_ORIGIN || !url.pathname.startsWith('/download/')) {
    throw new Error('Invalid Archive upstream URL');
  }
  return url.toString();
}

/** Encoded URL pathname for extension checks; clip query parameters are excluded. */
export function archiveUpstreamPathname(cleanPath: string): string {
  return new URL(toArchiveUpstreamUrl(cleanPath)).pathname;
}
