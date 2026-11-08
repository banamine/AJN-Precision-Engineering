import assert from "node:assert/strict";
import { AUDIO_ROW_HEIGHT_PX, computeRowWindow, ROW_HEIGHT_PX } from "./src/guide/virtualRows";

function sumSlice(heights: readonly number[], start: number, end: number): number {
  let s = 0;
  for (let i = start; i < end; i++) s += heights[i];
  return s;
}

// 1. N = 0
{
  const res = computeRowWindow({ heights: [], scrollTop: 0, viewportHeight: 800, overscan: 3 });
  assert.deepEqual(res, { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 });
}

// 2. 1 row
{
  const heights = [ROW_HEIGHT_PX];
  const res = computeRowWindow({ heights, scrollTop: 0, viewportHeight: 800, overscan: 0 });
  assert.deepEqual(res, { start: 0, end: 1, topSpacer: 0, bottomSpacer: 0 });
  const resNegative = computeRowWindow({ heights, scrollTop: -120, viewportHeight: 800, overscan: 3 });
  assert.deepEqual(resNegative, { start: 0, end: 1, topSpacer: 0, bottomSpacer: 0 });
  const resBeyond = computeRowWindow({ heights, scrollTop: 5000, viewportHeight: 800, overscan: 3 });
  assert.deepEqual(resBeyond, { start: 0, end: 1, topSpacer: 0, bottomSpacer: 0 });
}

// 3. viewportHeight = 0 and negative scrollTop
{
  const heights = Array.from({ length: 20 }, () => ROW_HEIGHT_PX);
  const total = sumSlice(heights, 0, heights.length);
  const resZeroVp = computeRowWindow({ heights, scrollTop: 0, viewportHeight: 0, overscan: 0 });
  assert.equal(resZeroVp.topSpacer + sumSlice(heights, resZeroVp.start, resZeroVp.end) + resZeroVp.bottomSpacer, total);
  assert.ok(resZeroVp.end - resZeroVp.start <= Math.ceil(0 / ROW_HEIGHT_PX) + 1);

  const resZeroVpOverscan = computeRowWindow({ heights, scrollTop: 200, viewportHeight: 0, overscan: 3 });
  assert.equal(
    resZeroVpOverscan.topSpacer + sumSlice(heights, resZeroVpOverscan.start, resZeroVpOverscan.end) + resZeroVpOverscan.bottomSpacer,
    total,
  );
  assert.ok(resZeroVpOverscan.end - resZeroVpOverscan.start <= Math.ceil(0 / ROW_HEIGHT_PX) + 2 * 3 + 1);
}

// 4. 150 mixed 68/84 rows at scrollTop 0 / middle / end / beyond, overscan 0 and 3
{
  const heights: number[] = Array.from({ length: 150 }, (_, i) => (i % 3 === 0 ? AUDIO_ROW_HEIGHT_PX : ROW_HEIGHT_PX));
  const total = sumSlice(heights, 0, heights.length);
  const viewportHeight = 680;
  const scrollPositions = [-50, 0, Math.floor(total / 2), total - viewportHeight, total + 10_000];

  for (const overscan of [0, 3]) {
    const maxMounted = Math.ceil(viewportHeight / ROW_HEIGHT_PX) + 2 * overscan + 1;
    for (const scrollTop of scrollPositions) {
      const win = computeRowWindow({ heights, scrollTop, viewportHeight, overscan });
      assert.ok(win.start >= 0 && win.start <= win.end && win.end <= heights.length, `bounds valid at scrollTop=${scrollTop}`);
      const mountedHeight = sumSlice(heights, win.start, win.end);
      assert.equal(win.topSpacer, sumSlice(heights, 0, win.start), `topSpacer exact at scrollTop=${scrollTop}`);
      assert.equal(win.bottomSpacer, sumSlice(heights, win.end, heights.length), `bottomSpacer exact at scrollTop=${scrollTop}`);
      assert.equal(win.topSpacer + mountedHeight + win.bottomSpacer, total, `spacer conservation at scrollTop=${scrollTop}`);
      const mountedCount = win.end - win.start;
      assert.ok(
        mountedCount <= maxMounted,
        `mounted count ${mountedCount} <= ${maxMounted} (scrollTop=${scrollTop}, overscan=${overscan})`,
      );
    }

    // Specific checks at start, middle, end
    const atStart = computeRowWindow({ heights, scrollTop: 0, viewportHeight, overscan });
    assert.equal(atStart.start, 0);
    assert.equal(atStart.topSpacer, 0);

    const atMiddle = computeRowWindow({ heights, scrollTop: Math.floor(total / 2), viewportHeight, overscan });
    assert.ok(atMiddle.start > 0 && atMiddle.end < heights.length);
    assert.ok(atMiddle.topSpacer > 0 && atMiddle.bottomSpacer > 0);

    const atEnd = computeRowWindow({ heights, scrollTop: total, viewportHeight, overscan });
    assert.equal(atEnd.end, heights.length);
    assert.equal(atEnd.bottomSpacer, 0);
  }
}

console.log("[virtual-rows] PASS — N=0, 1 row, 150 mixed 68/84 rows, scrollTop 0/mid/end, overscan 0/3, spacer conservation & mounted bounds");
