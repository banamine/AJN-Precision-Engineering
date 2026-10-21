import assert from 'node:assert/strict';
import { createArchiveHealth } from './server/archiveHealth.ts';

let clock = 100_000;
const create = () => createArchiveHealth({}, { now: () => clock });

{
  const health = create();
  health.record({ ts: clock, itemKey: 'a', kind: 'network' });
  health.record({ ts: clock, itemKey: 'b', kind: 'server5xx' });
  assert.equal(health.getStatus().state, 'ok', 'fewer than 3 failures is not degraded');
  health.record({ ts: clock, itemKey: 'c', kind: 'network' });
  health.record({ ts: clock, itemKey: 'd', kind: 'network' });
  health.record({ ts: clock, itemKey: 'e', kind: 'server5xx' });
  assert.equal(health.getStatus().state, 'down');
  assert.deepEqual(health.getStatus().recent, { failures: 5, successes: 0, distinctItems: 5 });
  console.log('PASS 5 network/server failures across 5 items → down');
}

{
  const health = create();
  for (const itemKey of ['same', 'same', 'same', 'same', 'same']) {
    health.record({ ts: clock, itemKey, kind: 'network' });
  }
  assert.equal(health.getStatus().state, 'degraded', 'one item cannot trip down');
  assert.equal(health.getStatus().recent.distinctItems, 1);
  console.log('PASS fewer than 3 distinct items never reaches down');
}

{
  const health = create();
  health.record({ ts: clock, itemKey: 'restricted', kind: 'definite' });
  health.record({ ts: clock, itemKey: 'other', kind: 'other' });
  assert.deepEqual(health.getStatus().recent, { failures: 0, successes: 0, distinctItems: 0 });
  assert.equal(health.getStatus().state, 'ok');
  console.log('PASS definite/item-specific failures do not count toward site health');
}

{
  const health = create();
  health.record({ ts: clock - 10_000, itemKey: 'healthy', kind: 'ok' });
  for (let i = 0; i < 5; i++) health.record({ ts: clock - 5_000, itemKey: `item-${i}`, kind: 'network' });
  assert.equal(health.getStatus().state, 'degraded', 'recent success blocks down');
  assert.equal(health.getStatus().recent.successes, 1);
  console.log('PASS a success within 30 seconds prevents down');
}

{
  const health = create();
  for (const itemKey of ['a', 'b', 'c', 'd', 'e']) health.record({ ts: clock, itemKey, kind: 'network' });
  assert.equal(health.getStatus().state, 'down');
  clock += 60_000;
  assert.equal(health.shouldProbe(clock), true);
  health.recordProbe({ ts: clock, archiveOk: true, controlOk: true });
  assert.equal(health.getStatus().state, 'down', 'one successful probe is not enough');
  assert.equal(health.shouldProbe(clock + 59_999), false);
  health.recordProbe({ ts: clock + 60_000, archiveOk: true, controlOk: true });
  assert.equal(health.getStatus().state, 'ok');
  console.log('PASS down → 2 consecutive successful probes → ok');
}

{
  const health = create();
  health.recordProbe({ ts: clock, archiveOk: false, controlOk: false });
  assert.equal(health.getStatus().state, 'unreachable_from_here');
  assert.equal(health.getStatus().control, 'failed');
  console.log('PASS failed Archive and control probes → unreachable_from_here');
}

{
  const health = create();
  health.recordProbe({ ts: clock, archiveOk: false, controlOk: true });
  assert.equal(health.getStatus().state, 'down');
  assert.equal(health.getStatus().control, 'ok');
  assert.equal(health.getStatus().nextProbeAt, clock + 120_000);
  health.recordProbe({ ts: clock + 120_000, archiveOk: false, controlOk: true });
  assert.equal(health.getStatus().nextProbeAt, clock + 120_000 + 240_000);
  console.log('PASS failed Archive / healthy control → down with 120 s then 240 s backoff');
}

{
  const health = create();
  for (let i = 0; i < 3; i++) health.record({ ts: clock, itemKey: `item-${i}`, kind: 'network' });
  assert.equal(health.getStatus().state, 'degraded');
  clock += 60_001;
  assert.equal(health.shouldProbe(clock), true);
  health.record({ ts: clock, itemKey: 'ok-1', kind: 'ok' });
  assert.equal(health.getStatus().state, 'ok', 'degraded clears when its 60 s evidence window expires');
  console.log('PASS degraded state uses rolling 60 s evidence window');
}
