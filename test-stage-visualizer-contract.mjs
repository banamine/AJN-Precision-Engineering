// Visualizer contract guard: fails the build if an audio stage can render with no spectrum, or if fake data creeps in.
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const mp = read("./src/MinimalPlayer.tsx");
const spec = read("./src/components/ArchiveMusicSpectrum.tsx");
const stage = read("./src/components/StageNowNext.tsx");
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed += 1; };

const spectrumUses = (mp.match(/<ArchiveMusicSpectrum\b/g) || []).length;
check("MinimalPlayer renders ArchiveMusicSpectrum in archive, radio-briefing and general audio stages (>= 3)", spectrumUses >= 3);
check("general audio stage renders the spectrum when not in radio-briefing mode", /\{!radioBriefingOn && \(\s*<ArchiveMusicSpectrum/.test(mp));
check("live radio stage shows StageLiveRadioInfo", /<StageLiveRadioInfo\b/.test(mp));
check("archive stage shows StageUpNext from the real queue", /<StageUpNext\b/.test(mp) && /archiveMusicUpcoming\?\.\[0\]/.test(mp));
for (const [n, src] of [["ArchiveMusicSpectrum", spec], ["StageNowNext", stage]]) {
  check(`${n} has no Math.random (no fake telemetry)`, !/Math\.random\s*\(/.test(src));
}
check("spectrum tells the viewer when the meter cannot read a stream", /Meter unavailable for this stream/.test(spec) && /No signal from this source/.test(spec));
check("live radio info never invents an Up next", !/Up next/i.test(stage.split("export function StageLiveRadioInfo")[1] || ""));
if (failed) { console.error(`${failed} visualizer contract check(s) failed`); process.exit(1); }
console.log("visualizer contract OK");
