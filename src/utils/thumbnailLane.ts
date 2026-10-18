export const THUMBNAIL_LANE_LIMIT = 4;

interface PendingThumbnail {
  cancelled: boolean;
  granted: boolean;
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
