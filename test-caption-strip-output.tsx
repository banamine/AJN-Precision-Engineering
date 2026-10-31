import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptionStrip } from "./src/news/captions/CaptionStrip.tsx";
import type { CaptionState } from "./src/news/captions/useCaptionTrack.ts";
import { RADIO_CAPTION_DISPLAY_LABEL } from "./src/news/captions/useRadioCaptionTrack.ts";

const shell = "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm";
const render = (state: CaptionState, compact = false) => renderToStaticMarkup(React.createElement(CaptionStrip, { state, compact }));
const expected = [
  [{ phase: "off" } as CaptionState, ""],
  [{ phase: "planning" } as CaptionState, `<div data-testid="captions-planning" role="status" class="${shell} text-neutral-400">Looking for captions…</div>`],
  [{ phase: "none" } as CaptionState, `<div data-testid="captions-none" role="status" class="${shell} text-neutral-300">No captions for this program.</div>`],
  [{ phase: "paused", retryAfter: 7 } as CaptionState, `<div data-testid="captions-paused" role="status" class="${shell} text-amber-300">Captions paused: Internet Archive asked us to slow down. Resuming in about 7 s.</div>`],
  [{ phase: "error", reason: "fixture unavailable" } as CaptionState, `<div data-testid="captions-error" role="alert" class="${shell} text-red-300">Captions unavailable (fixture unavailable).</div>`],
  [{
    phase: "ready", kind: "broadcast-cc", label: "BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE",
    before: [{ start: 1, end: 2, text: "SYNTHETIC_NEWS_BEFORE" }],
    current: { start: 3, end: 4, text: "SYNTHETIC_NEWS_CURRENT" }, waiting: false,
  } as CaptionState, `<section data-testid="captions-panel" aria-label="Captions" class="${shell}"><div data-testid="captions-label" class="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE</div><div aria-live="off" class="max-h-28 space-y-1 overflow-y-auto text-neutral-400"><p class="leading-snug">SYNTHETIC_NEWS_BEFORE</p></div><p data-testid="captions-current" aria-live="polite" class="mt-1 min-h-[1.75rem] text-base font-medium leading-snug text-neutral-50">SYNTHETIC_NEWS_CURRENT</p></section>`],
] as const;

for (const [state, markup] of expected) assert.equal(render(state), markup);
assert.equal(render({ phase: "ready", kind: "asr", label: RADIO_CAPTION_DISPLAY_LABEL, current: null, before: [], waiting: true }, true)
  .includes(`>${RADIO_CAPTION_DISPLAY_LABEL}</div>`), true);
assert.equal(render({ phase: "ready", kind: "asr", label: RADIO_CAPTION_DISPLAY_LABEL, current: null, before: [], waiting: true }, true)
  .includes(">…</p>"), true);
assert.equal(render({ phase: "ready", kind: "asr", label: RADIO_CAPTION_DISPLAY_LABEL, current: null, before: [], waiting: true }, true)
  .includes("max-h-28"), true);
console.log("caption strip state markup, News output baseline, test IDs, and radio label: all passed");
