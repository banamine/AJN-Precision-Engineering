export const ROW_HEIGHT_PX = 68;
export const AUDIO_ROW_HEIGHT_PX = 84;

export interface RowWindowArgs {
  heights: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
}

export interface RowWindowResult {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
}

export function buildHeightPrefixSums(heights: readonly number[]): Float64Array {
  const n = heights.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    prefix[i + 1] = prefix[i] + (Number.isFinite(h) && h > 0 ? h : 0);
  }
  return prefix;
}

/**
 * Pure prefix-sum binary-search row windowing helper.
 * Finds the first row whose bottom > clamped scrollTop, applies overscan,
 * and computes exact topSpacer and bottomSpacer pixel heights.
 */
export function computeRowWindow(args: RowWindowArgs): RowWindowResult {
  const { heights, scrollTop, viewportHeight, overscan } = args;
  const n = heights.length;
  if (n === 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }

  const prefix = buildHeightPrefixSums(heights);
  const total = prefix[n];
  if (total <= 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }

  const safeOverscan = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;
  const safeViewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const rawScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  const maxScrollTop = safeViewport > 0 ? Math.max(0, total - safeViewport) : Math.max(0, total - 1);
  const clampedTop = Math.min(Math.max(0, rawScrollTop), maxScrollTop);

  // Binary search for the first row i in [0, n - 1] with prefix[i + 1] > clampedTop
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (prefix[mid + 1] <= clampedTop) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const first = lo;

  let lastVisible: number;
  if (safeViewport <= 0) {
    lastVisible = first - 1;
  } else {
    const viewBottom = clampedTop + safeViewport;
    let lo2 = first;
    let hi2 = n - 1;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2 + 1) >>> 1;
      if (prefix[mid] < viewBottom) {
        lo2 = mid;
      } else {
        hi2 = mid - 1;
      }
    }
    lastVisible = lo2;
  }

  const start = Math.max(0, first - safeOverscan);
  const end = Math.min(n, Math.max(start, lastVisible + 1 + safeOverscan));
  const topSpacer = prefix[start];
  const bottomSpacer = Math.max(0, total - prefix[end]);

  return { start, end, topSpacer, bottomSpacer };
}
