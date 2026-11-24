import assert from 'node:assert/strict';
import { stageVirtualSize } from './stageSize';
assert.deepEqual(stageVirtualSize(1920, 1080), { w: 1920, h: 1080 });
assert.deepEqual(stageVirtualSize(0, 0), { w: 1920, h: 1080 });
assert.deepEqual(stageVirtualSize(832, 324), { w: 2773, h: 1080 });     // the short, wide window in the screenshot
assert.deepEqual(stageVirtualSize(1000, 1000), { w: 1920, h: 1920 });
assert.deepEqual(stageVirtualSize(5000, 500), { w: 4320, h: 1080 });    // clamped to 4:1
// u = min(w/1920, h/1080) in pixels: both axes of the virtual space map exactly onto the box
for (const [bw, bh] of [[832, 324], [1360, 436], [900, 900], [1920, 1080]]) {
  const v = stageVirtualSize(bw, bh), u = Math.min(bw / 1920, bh / 1080);
  assert.ok(Math.abs(v.w * u - bw) <= 1 || Math.abs(v.h * u - bh) <= 1, `${bw}x${bh}`);
}
console.log('stageSize ok');
