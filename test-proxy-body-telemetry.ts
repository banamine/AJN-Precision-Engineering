import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { attachProxyBodyTelemetry, recordProxyBodyStall, type ProxyBodyStallSnapshot } from './server/proxyBodyTelemetry.ts';

async function waitForStall(
  makeStreams: () => { source: Readable; destination: Writable; cleanup: () => void },
): Promise<ProxyBodyStallSnapshot> {
  const streams = makeStreams();
  let timer: NodeJS.Timeout;
  let telemetry: ReturnType<typeof attachProxyBodyTelemetry>;
  const stalled = new Promise<ProxyBodyStallSnapshot>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('fixture did not reach the body-stall timeout')), 1500);
    telemetry = attachProxyBodyTelemetry(streams.source, streams.destination, {
      idleMs: 100,
      onStall: resolve,
    });
    streams.source.pipe(streams.destination);
  });
  try {
    return await stalled;
  } finally {
    clearTimeout(timer!);
    telemetry!.dispose();
    streams.cleanup();
  }
}

{
  const snapshot = await waitForStall(() => {
    let sent = false;
    const source = new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(Buffer.from('upstream bytes'));
        // Deliberately leave the source open to model an upstream body that stops sending.
      },
    });
    const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    return { source, destination, cleanup: () => { source.destroy(); destination.destroy(); } };
  });
  const counters = { failedRequests: 0, bodyStallsUpstream: 0, bodyStallsBackpressure: 0 };
  recordProxyBodyStall(counters, snapshot);
  assert.equal(snapshot.backpressured, false);
  assert.deepEqual(counters, { failedRequests: 1, bodyStallsUpstream: 1, bodyStallsBackpressure: 0 });
  assert.equal(snapshot.upstreamBytes, Buffer.byteLength('upstream bytes'));
  assert.equal(snapshot.clientBytesWritten, Buffer.byteLength('upstream bytes'));
  assert.ok(snapshot.msSinceLastUpstreamChunk >= 90);
  console.log('PASS fake upstream stop is classified as upstream stall');
}

{
  const snapshot = await waitForStall(() => {
    let sent = false;
    const source = new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(Buffer.from('blocked client'));
        // The next read remains pending; the test destination does not drain.
      },
    });
    const destination = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) {
        // Intentionally withhold the callback so Writable never drains.
      },
    });
    return { source, destination, cleanup: () => { source.destroy(); destination.destroy(); } };
  });
  const counters = { failedRequests: 0, bodyStallsUpstream: 0, bodyStallsBackpressure: 0 };
  recordProxyBodyStall(counters, snapshot);
  assert.equal(snapshot.backpressured, true);
  assert.deepEqual(counters, { failedRequests: 1, bodyStallsUpstream: 0, bodyStallsBackpressure: 1 });
  assert.equal(snapshot.upstreamBytes, Buffer.byteLength('blocked client'));
  assert.equal(snapshot.clientBytesWritten, Buffer.byteLength('blocked client'));
  assert.ok(snapshot.pausedForBackpressureMs >= 90);
  console.log('PASS non-draining client is classified as backpressure stall');
}
