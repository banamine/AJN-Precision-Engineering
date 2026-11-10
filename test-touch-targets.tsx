import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// theme.css sets `min-height: 44px` on every button under .ajn-platform-shell. It loads after the
// utilities and has the same specificity, so a plain min-h-[48px] loses and the control renders 44px.
// The important flag is what makes the 48px targets real. Keep it.
const theme = fs.readFileSync('src/components/ajn-platform-redesign/theme.css', 'utf-8');
assert.match(theme, /:where\(button, a\[role="button"\], select\)\s*\{\s*\n\s*min-height: 44px;/, 'the 44px floor still exists, so the guard below is still needed');

for (const file of ['src/components/MiniPlayerDock.tsx', 'src/components/RadioPresetsBar.tsx', 'src/components/RadioDock.tsx', 'src/components/Navigation.tsx']) {
  const src = fs.readFileSync(file, 'utf-8');
  const bare = src.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /(?<!!)min-h-\[48px\]/.test(l));
  assert.equal(bare.length, 0, `${file}: min-h-[48px] without the important flag on line(s) ${bare.map(([n]) => n).join(', ')} — theme.css will cap it to 44px`);
}

// The spectrum must never show an unexplained empty box: either bars, or a reason.
const spec = fs.readFileSync('src/components/ArchiveMusicSpectrum.tsx', 'utf-8');
assert.match(spec, /No signal from this source/, 'playing audio the analyser cannot read must say so');
assert.match(spec, /setNoSignal\(true\), 2000/, 'and only after a sustained silence, not on a gap in the track');

// #persistent-player is a <div> wrapper. Casting it to a media element makes .volume undefined,
// which both breaks the volume control and flips a controlled input to uncontrolled.
for (const file of ['src/components/RadioPresetsBar.tsx', 'src/components/RadioDock.tsx', 'src/components/MiniPlayerDock.tsx', 'src/components/RadioView.tsx']) {
  const src = fs.readFileSync(file, 'utf-8');
  assert.ok(!/getElementById\('persistent-player'\)\s*as\s*HTMLMediaElement/.test(src), `${file}: #persistent-player is a div, not a media element - use findPersistentMedia()`);
}

const { ArchiveMusicSpectrum } = await import('./src/components/ArchiveMusicSpectrum');
const noAnalyser = renderToStaticMarkup(createElement(ArchiveMusicSpectrum, { analyser: null, isPlaying: true, analyzerState: 'unavailable' } as never));
assert.match(noAnalyser, /Spectrum unavailable/);
const live = renderToStaticMarkup(createElement(ArchiveMusicSpectrum, { analyser: {} as never, isPlaying: true, analyzerState: 'active' } as never));
assert.ok(!/Spectrum unavailable|No signal/.test(live), 'a working spectrum carries no note');
console.log('touch targets + spectrum honesty: all checks passed');
