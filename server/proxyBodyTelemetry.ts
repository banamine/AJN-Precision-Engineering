import type { Readable, Writable } from 'node:stream';

export interface ProxyBodyTelemetrySnapshot {
  firstUpstreamChunkAt: number | null;
  lastUpstreamChunkAt: number | null;
  upstreamBytes: number;
  clientBytesWritten: number;
  pausedForBackpressureMs: number;
  msSinceLastUpstreamChunk: number;
  msSinceLastDrain: number;
  backpressured: boolean;
}

export interface ProxyBodyStallSnapshot extends ProxyBodyTelemetrySnapshot {
  idleMs: number;
}

export interface ProxyBodyTelemetryOptions {
  idleMs: number;
  now?: () => number;
  onStall: (snapshot: ProxyBodyStallSnapshot) => void;
}

export interface ProxyBodyStallCounters {
  failedRequests: number;
  bodyStallsUpstream: number;
  bodyStallsBackpressure: number;
}

export interface ProxyBodyTelemetry {
  snapshot(): ProxyBodyTelemetrySnapshot;
  dispose(): void;
}

export function recordProxyBodyStall(
  counters: ProxyBodyStallCounters,
  snapshot: Pick<ProxyBodyStallSnapshot, 'backpressured'>,
): void {
  counters.failedRequests += 1;
  if (snapshot.backpressured) counters.bodyStallsBackpressure += 1;
  else counters.bodyStallsUpstream += 1;
}

function chunkBytes(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
  }
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  return 0;
}

/**
 * Observe a proxied response without buffering it or changing the existing idle timeout.
 * `clientBytesWritten` counts bytes accepted by destination.write(); it does not claim
 * that those bytes have already reached the remote socket.
 */
export function attachProxyBodyTelemetry(
  source: Readable,
  destination: Writable,
  options: ProxyBodyTelemetryOptions,
): ProxyBodyTelemetry {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let firstUpstreamChunkAt: number | null = null;
  let lastUpstreamChunkAt: number | null = null;
  let lastDrainAt: number | null = null;
  let upstreamBytes = 0;
  let clientBytesWritten = 0;
  let pausedForBackpressureMs = 0;
  let backpressureStartedAt: number | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let stallFired = false;
  let disposed = false;

  const snapshot = (): ProxyBodyTelemetrySnapshot => {
    const at = now();
    const activeBackpressureMs = backpressureStartedAt === null ? 0 : Math.max(0, at - backpressureStartedAt);
    return {
      firstUpstreamChunkAt,
      lastUpstreamChunkAt,
      upstreamBytes,
      clientBytesWritten,
      pausedForBackpressureMs: pausedForBackpressureMs + activeBackpressureMs,
      msSinceLastUpstreamChunk: Math.max(0, at - (lastUpstreamChunkAt ?? startedAt)),
      msSinceLastDrain: Math.max(0, at - (lastDrainAt ?? startedAt)),
      backpressured: backpressureStartedAt !== null,
    };
  };

  const clearIdle = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (disposed || stallFired) return;
      stallFired = true;
      options.onStall({ ...snapshot(), idleMs: options.idleMs });
    }, options.idleMs);
  };
  const onChunk = (chunk: Buffer | Uint8Array | string) => {
    const bytes = chunkBytes(chunk, 'utf8');
    const at = now();
    firstUpstreamChunkAt ??= at;
    lastUpstreamChunkAt = at;
    upstreamBytes += bytes;
    armIdle();
  };
  const onDrain = () => {
    const at = now();
    lastDrainAt = at;
    if (backpressureStartedAt !== null) {
      pausedForBackpressureMs += Math.max(0, at - backpressureStartedAt);
      backpressureStartedAt = null;
    }
  };
  const originalWrite = destination.write;
  const wrappedWrite = function (this: Writable, ...args: unknown[]): boolean {
    const accepted = Reflect.apply(originalWrite, this, args) as boolean;
    clientBytesWritten += chunkBytes(args[0], args[1]);
    if (!accepted && backpressureStartedAt === null) backpressureStartedAt = now();
    return accepted;
  };

  destination.write = wrappedWrite as Writable['write'];
  source.on('data', onChunk);
  destination.on('drain', onDrain);
  armIdle();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearIdle();
    if (backpressureStartedAt !== null) {
      pausedForBackpressureMs += Math.max(0, now() - backpressureStartedAt);
      backpressureStartedAt = null;
    }
    source.off('data', onChunk);
    destination.off('drain', onDrain);
    if (destination.write === wrappedWrite) destination.write = originalWrite;
  };

  source.once('end', dispose);
  source.once('close', dispose);
  source.once('error', dispose);
  destination.once('close', dispose);

  return { snapshot, dispose };
}
