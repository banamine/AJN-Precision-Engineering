import assert from 'node:assert/strict';
import { createArchiveHealth, type ArchiveHealthLogEntry, type ArchiveProbeOutcome } from './server/archiveHealth.ts';

let clock = 100_000;
const make = () => {
  const lines: ArchiveHealthLogEntry[] = [];
  const health = createArchiveHealth({}, { now: () => clock, log: (line) => lines.push(line) });
  return { health, lines };
};
const recordFailure = (health: ReturnType<typeof createArchiveHealth>, key: string, ts = clock) => {
  health.record({ ts, itemKey: key, kind: 'network', httpStatus: null, errorCode: 'ECONNRESET', path: `/download/${key}/file.mp4` });
};
const probe = (ok: boolean, path: string): ArchiveProbeOutcome => ({
  ok,
  httpStatus: ok ? 204 : null,
  errorCode: ok ? null : 'ECONNRESET',
  errorMessage: ok ? undefined : 'socket reset',
  path,
});

{
  const { health } = make();
  for (const key of ['a', 'b', 'c', 'd', 'e']) recordFailure(health, key);
  assert.equal(health.getStatus().state, 'down');
  assert.deepEqual(health.getStatus().recent, { failures: 5, successes: 0, distinctItems: 5 });
  console.log('PASS five counted failures across three or more keys with no recent success → down');
}

{
  const { health } = make();
  for (let i = 0; i < 5; i++) recordFailure(health, 'same');
  assert.equal(health.getStatus().state, 'degraded', 'one item cannot trip down');
  assert.equal(health.getStatus().recent.distinctItems, 1);
  console.log('PASS repeated failures for fewer than three distinct keys never reach down');
}

{
  const { health, lines } = make();
  const before = health.getStatus();
  health.record({ ts: clock, itemKey: 'private-item', kind: 'definite', httpStatus: 403, errorCode: null, path: '/download/private-item/f.mp4?token=not-logged' });
  const after = health.getStatus();
  assert.deepEqual(after, before, 'item-specific failure does not mutate provider state');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].counted, false);
  assert.equal(lines[0].kind, 'definite');
  assert.equal(lines[0].path, '/download/private-item/f.mp4');
  assert.equal(lines[0].errorCode, null);
  assert.equal(JSON.stringify(lines[0]).includes('not-logged'), false);
  console.log('PASS item-specific outcome is logged counted:false without a query string or state change');
}

{
  const { health } = make();
  health.record({ ts: clock - 10_000, itemKey: 'healthy', kind: 'ok', httpStatus: 206 });
  for (let i = 0; i < 5; i++) recordFailure(health, `item-${i}`, clock - 5_000);
  assert.equal(health.getStatus().state, 'degraded', 'success within 30 seconds blocks down');
  assert.equal(health.getStatus().recent.successes, 1);
  console.log('PASS success within 30 seconds prevents down');
}

{
  const { health } = make();
  for (let i = 0; i < 4; i++) recordFailure(health, `ratio-fail-${i}`);
  health.record({ ts: clock, itemKey: 'ratio-ok-1', kind: 'ok', httpStatus: 206 });
  health.record({ ts: clock, itemKey: 'ratio-ok-2', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().recent.failures + health.getStatus().recent.successes, 6);
  assert.equal(health.getStatus().state, 'degraded', 'two of six successes is below the 50% threshold');
  console.log('PASS six-sample success ratio below 50% → degraded');
}

{
  const { health } = make();
  for (let i = 0; i < 5; i++) recordFailure(health, `spread-${i}`, clock + i * 22_500);
  clock += 90_000;
  assert.notEqual(health.getStatus().state, 'down');
  assert.ok(health.getStatus().recent.failures < 5);
  console.log('PASS five failures spread over 90 seconds do not reach down');
}

{
  const { health } = make();
  for (const key of ['a', 'b', 'c', 'd', 'e']) recordFailure(health, key);
  assert.equal(health.getStatus().state, 'down');

  const t = clock + 60_000;
  health.record({ ts: t, itemKey: 'success-1', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'down', 'one real success is not enough');
  health.record({ ts: t + 1, itemKey: 'specific-404', kind: 'definite', httpStatus: 404 });
  health.record({ ts: t + 2, itemKey: 'success-2', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'down', 'an uncounted item failure still breaks the success streak');
  recordFailure(health, 'between-successes', t + 3);
  health.record({ ts: t + 4, itemKey: 'success-3', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'down', 'counted failure resets consecutive success count');
  health.recordProbe({
    ts: t + 5,
    archive: probe(true, '/'),
    control: probe(true, '/generate_204'),
  });
  assert.equal(health.getStatus().state, 'ok', 'real request + successful probe are two consecutive Archive successes');
  console.log('PASS down recovers after two consecutive successes; intervening failure resets recovery');
}

{
  const { health, lines } = make();
  health.recordProbe({
    ts: clock,
    archive: probe(false, '/'),
    control: probe(false, '/generate_204'),
  });
  assert.equal(health.getStatus().state, 'unreachable_from_here');
  assert.equal(health.getStatus().control, 'failed');
  health.record({ ts: clock + 1, itemKey: 'reachable-1', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'unreachable_from_here');
  health.record({ ts: clock + 2, itemKey: 'reachable-2', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'ok', 'two consecutive real Archive responses also recover unreachable');
  assert.ok(lines.some((line) => line.state === 'unreachable_from_here' && typeof line.transitionReason === 'string'));
  assert.ok(lines.some((line) => line.state === 'ok' && typeof line.transitionReason === 'string'));
  console.log('PASS simultaneous Archive and control failures → unreachable_from_here');
}

{
  const { health, lines } = make();
  for (const key of ['a', 'b', 'c', 'd', 'e']) recordFailure(health, key);
  assert.equal(health.getStatus().state, 'down');
  assert.ok(lines.some((line) => line.state === 'down' && typeof line.transitionReason === 'string'));
  assert.equal(health.getStatus().control, 'unknown');
  health.recordProbe({
    ts: clock + 1,
    archive: probe(false, '/'),
    control: probe(false, '/generate_204'),
  });
  assert.equal(health.getStatus().state, 'unreachable_from_here', 'unreachable takes precedence over down');
  console.log('PASS control unknown uses down threshold; simultaneous control failure overrides down');
}

{
  const { health } = make();
  for (const key of ['a', 'b', 'c', 'd', 'e']) recordFailure(health, key);
  health.recordProbe({
    ts: clock + 1,
    archive: probe(false, '/'),
    control: { ok: null, httpStatus: null, errorCode: null, errorReason: 'blocked', path: '/' },
  });
  assert.equal(health.getStatus().control, 'unknown', 'a blocked control check did not run');
  assert.equal(health.getStatus().state, 'down', 'unknown control must not override Archive down with unreachable');
  console.log('PASS unavailable control check remains unknown; Archive down is still evaluated');
}

{
  const { health } = make();
  for (const key of ['a', 'b', 'c', 'd', 'e']) recordFailure(health, key);
  health.recordProbe({
    ts: clock + 1,
    archive: probe(false, '/'),
    control: probe(false, '/generate_204'),
  });
  assert.equal(health.getStatus().state, 'unreachable_from_here');
  health.recordProbe({
    ts: clock + 2,
    archive: probe(false, '/'),
    control: probe(true, '/generate_204'),
  });
  assert.equal(health.getStatus().control, 'ok');
  assert.equal(health.getStatus().state, 'down', 'once control succeeds, evaluate Archive threshold on its own');
  console.log('PASS control recovery removes unreachable precedence and evaluates Archive thresholds');
}

{
  const { health } = make();
  for (let i = 0; i < 3; i++) recordFailure(health, `degraded-${i}`);
  assert.equal(health.getStatus().state, 'degraded');
  const recoveredAt = clock + 60_001;
  health.record({ ts: recoveredAt, itemKey: 'recovered', kind: 'ok', httpStatus: 206 });
  assert.equal(health.getStatus().state, 'ok', 'degraded recovers after a full window and a success');
  console.log('PASS degraded recovers after a full 60-second window with fewer than three failures and a success');
}

{
  const { health, lines } = make();
  health.record({
    ts: clock,
    itemKey: 'log-key',
    kind: 'network',
    httpStatus: null,
    errorCode: 'ECONNRESET',
    path: '/download/log-key/f.mp4?session=secret',
  });
  const entry = lines[0];
  for (const field of ['ts', 'itemKey', 'kind', 'httpStatus', 'errorCode', 'counted', 'state', 'path']) {
    assert.ok(Object.hasOwn(entry, field), `structured log includes ${field}`);
  }
  assert.equal(entry.itemKey, 'log-key');
  assert.equal(entry.errorCode, 'ECONNRESET');
  assert.equal(entry.path, '/download/log-key/f.mp4');
  assert.equal(JSON.stringify(entry).includes('secret'), false);
  console.log('PASS each observed outcome logs the required JSON fields and excludes query data');
}

{
  const fresh = createArchiveHealth({}, { now: () => 1_000, log: () => {} });
  assert.equal(fresh.getStatus().state, 'unknown', 'no data yet must not report ok');
  fresh.record({ ts: 1_001, itemKey: 'first', kind: 'ok', httpStatus: 206 });
  assert.equal(fresh.getStatus().state, 'ok', 'first counted success reports ok');
}

console.log('Archive health state machine tests: PASS');
