import assert from 'node:assert/strict';
import { scheduleResumePromptFade } from './src/utils/resumePromptFade.ts';

function fakeClock() {
  let now = 0; let nextId = 1;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => { const id = nextId++; jobs.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id: unknown) => { jobs.delete(id as number); },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; jobs.delete(due[0]); due[1].fn();
      }
      now = target;
    },
  };
}

// Untouched: stays 10 s, fades, hides 600 ms later.
{
  const c = fakeClock(); const log: string[] = [];
  scheduleResumePromptFade({ visibleMs: 10_000, fadeMs: 600, onFade: () => log.push('fade'), onHide: () => log.push('hide'), ...c });
  c.advance(9_999); assert.deepEqual(log, []);
  c.advance(1); assert.deepEqual(log, ['fade']);
  c.advance(599); assert.deepEqual(log, ['fade']);
  c.advance(1); assert.deepEqual(log, ['fade', 'hide']);
}
// Interaction before 10 s cancels everything.
{
  const c = fakeClock(); const log: string[] = [];
  const cancel = scheduleResumePromptFade({ visibleMs: 10_000, fadeMs: 600, onFade: () => log.push('fade'), onHide: () => log.push('hide'), ...c });
  c.advance(4_000); cancel(); c.advance(60_000);
  assert.deepEqual(log, []);
}
// Interaction during the fade stops the hide.
{
  const c = fakeClock(); const log: string[] = [];
  const cancel = scheduleResumePromptFade({ visibleMs: 10_000, fadeMs: 600, onFade: () => log.push('fade'), onHide: () => log.push('hide'), ...c });
  c.advance(10_100); cancel(); c.advance(5_000);
  assert.deepEqual(log, ['fade']);
}
console.log('resume prompt fade timing: all passed');
