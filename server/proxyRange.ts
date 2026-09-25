// Cloud Run rejects HTTP/1 responses larger than 32 MiB (empty 500). Media
// requests usually ask for "bytes=0-" (the whole file), so the proxy always asks
// Archive for a bounded slice and answers 206; the browser fetches the next one.
export const PROXY_SLICE_BYTES = 8 * 1024 * 1024;

export function proxySliceRange(header: string | undefined, slice = PROXY_SLICE_BYTES): { start: number; end: number } {
  const m = /^bytes=(\d+)-(\d*)$/.exec(String(header ?? '').trim());
  const start = m ? Number(m[1]) : 0;
  const askedEnd = m && m[2] !== '' ? Number(m[2]) : null;
  const cap = start + slice - 1;
  return { start, end: askedEnd !== null && askedEnd >= start ? Math.min(askedEnd, cap) : cap };
}
