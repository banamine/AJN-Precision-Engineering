interface Job<T> {
  run: (signal: AbortSignal) => Promise<T>;
  signal: AbortSignal;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  started: boolean;
  abortListener: () => void;
}

export interface SchedulePoolSnapshot {
  active: number;
  queued: number;
}

export function createChannelSchedulePool(limit = 4) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  const queue: Job<unknown>[] = [];
  let active = 0;

  const pump = () => {
    while (active < limit && queue.length > 0) {
      const job = queue.shift();
      if (!job) return;
      if (job.signal.aborted) {
        job.signal.removeEventListener('abort', job.abortListener);
        job.reject(new DOMException('The operation was aborted', 'AbortError'));
        continue;
      }
      job.started = true;
      active++;
      const finish = () => {
        job.signal.removeEventListener('abort', job.abortListener);
        active--;
        pump();
      };
      void job.run(job.signal).then(
        (value) => { finish(); job.resolve(value); },
        (error: unknown) => { finish(); job.reject(error); },
      );
    }
  };

  return {
    run<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
      return new Promise<T>((resolve, reject) => {
        const job: Job<T> = {
          run: task,
          signal,
          resolve,
          reject,
          started: false,
          abortListener: () => {
            if (job.started) return;
            const index = queue.indexOf(job as Job<unknown>);
            if (index >= 0) queue.splice(index, 1);
            signal.removeEventListener('abort', job.abortListener);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          },
        };
        signal.addEventListener('abort', job.abortListener, { once: true });
        queue.push(job as Job<unknown>);
        pump();
      });
    },
    snapshot(): SchedulePoolSnapshot {
      return { active, queued: queue.length };
    },
  };
}

export const channelSchedulePool = createChannelSchedulePool(4);
