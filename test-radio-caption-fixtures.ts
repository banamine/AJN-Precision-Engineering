import type { Cue } from "./src/news/captions/captionTrack.ts";

export const RADIO_FIXTURE_ID = "The_Alex_Jones_Radio_Show_20210910_170000";

function makeEvenlySpaced(start: number, end: number, count: number, prefix: string): Cue[] {
  return Array.from({ length: count }, (_, index) => {
    const cueStart = count === 1 ? start : start + (end - start) * index / (count - 1);
    return {
      start: Number(cueStart.toFixed(3)),
      end: Number((cueStart + 1.2).toFixed(3)),
      text: `SYNTHETIC_FIXTURE_${prefix}_${String(index).padStart(2, "0")}`,
    };
  });
}

export function radioFixtureSlice(start: number): Cue[] {
  if (start === 0) return makeEvenlySpaced(0.15, 58.2, 17, "T0");
  if (start === 60) return makeEvenlySpaced(60.12, 118.43, 19, "T60");
  return makeEvenlySpaced(start + 0.12, start + 1.32, 1, `T${start}`);
}

export function radioFixturePlan() {
  return {
    identifier: RADIO_FIXTURE_ID,
    source: "asr",
    label: "Machine transcript (Archive ASR, may contain errors)",
    file: `${RADIO_FIXTURE_ID}.asr.srt`,
  };
}

export function radioFixtureSliceBody(start: number) {
  return {
    identifier: RADIO_FIXTURE_ID,
    source: "asr",
    label: "Machine transcript (Archive ASR, may contain errors)",
    sliceStart: start,
    timeBase: "absolute",
    bytes: 0,
    cues: radioFixtureSlice(start),
  };
}
