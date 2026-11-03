export const THUMBNAIL_LANE_LIMIT = 4;

/**
 * A slot is normally released when its image loads, errors or unmounts. A request that does none of those
 * (a stalled host, e.g. a Fox clip thumbnail that never answers) used to hold its slot forever, and
 * THUMBNAIL_LANE_LIMIT of them starved every other logo and thumbnail on the page. After this long the
 * lane takes the slot back so the rest of the queue keeps moving; the stalled image may still finish later.
 * Mutable so tests do not have to wait for the real value.
 */
export const thumbnailLaneConfig = { leaseTimeoutMs: 8_000 };

interface PendingThumbnail {
  cancelled: boolean;
  granted: boolean;
  leaseTimer?: ReturnType<typeof setTimeout>;
  onGranted: (release: () => void) => void;
  release: () => void;
}

let activeLoads = 0;
const waiting: PendingThumbnail[] = [];

function pump(): void {
  while (activeLoads < THUMBNAIL_LANE_LIMIT && waiting.length > 0) {
    const job = waiting.shift();
    if (!job || job.cancelled) continue;
    job.granted = true;
    activeLoads++;
    job.leaseTimer = setTimeout(job.release, thumbnailLaneConfig.leaseTimeoutMs);
    job.onGranted(job.release);
  }
}

/** Enqueue one image request. The slot is released on load/error or when its owner unmounts. */
export function enqueueThumbnailLoad(onGranted: (release: () => void) => void): () => void {
  const job: PendingThumbnail = {
    cancelled: false,
    granted: false,
    onGranted,
    release: () => {
      if (!job.granted) return;
      job.granted = false;
      if (job.leaseTimer !== undefined) { clearTimeout(job.leaseTimer); job.leaseTimer = undefined; }
      activeLoads = Math.max(0, activeLoads - 1);
      pump();
    },
  };
  waiting.push(job);
  pump();
  return () => {
    job.cancelled = true;
    if (job.granted) job.release();
    else {
      const index = waiting.indexOf(job);
      if (index >= 0) waiting.splice(index, 1);
    }
  };
}

export function thumbnailLaneStats(): { active: number; queued: number; limit: number } {
  return { active: activeLoads, queued: waiting.filter((job) => !job.cancelled).length, limit: THUMBNAIL_LANE_LIMIT };
}
