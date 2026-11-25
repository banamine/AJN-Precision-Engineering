import assert from 'node:assert/strict';
(globalThis as any).window = globalThis;
(globalThis as any).location = { origin: 'http://x' };
const { attachPlayTimeline } = await import('./src/utils/playTimeline');
const el: any = Object.assign(new EventTarget(), { currentTime: 0, readyState: 0, networkState: 0, preload: 'none', crossOrigin: 'anonymous', duration: NaN, error: null });
attachPlayTimeline(el, { restored: true, src: 'https://s/x', startAtSeconds: 600 });
for (const n of ['play', 'loadstart', 'loadedmetadata', 'playing']) el.dispatchEvent(new Event(n));
const tl = (globalThis as any).__ajnTimelines[0];
assert.deepEqual(tl.marks.map((m: any) => m.ev), ['element-created', 'play', 'loadstart', 'loadedmetadata', 'playing']);
assert.match(tl.marks[0].note, /restored=true startAt=600 preload=none crossOrigin=anonymous/);
assert.equal(typeof (globalThis as any).__ajnTimeline, 'function');
// a throwing element never breaks the caller
attachPlayTimeline(null as any, { restored: false, src: 'x' });
console.log('PASS play timeline');
