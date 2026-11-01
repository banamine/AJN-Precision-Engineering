import { useEffect, useState, type ReactElement } from 'react';
import { ArchiveMusicSpectrum } from './ArchiveMusicSpectrum';
import { useAnalyzerState } from './AudioVisualizerOverlay';
import { getSharedAnalyser } from '../use-audio-normalization';

interface RadioSpectrumProps {
  /** True only while a live station is actually playing. */
  playing: boolean;
  className?: string;
}

/**
 * Live-radio spectrum. Reads the app-wide analyser the persistent player already feeds; creates no audio nodes, uses no synthetic values.
 * Streams the browser cannot read (no CORS) have no analyser, and the spectrum then shows its own unavailable state instead of fake bars.
 */
export function RadioSpectrum({ playing, className = '' }: RadioSpectrumProps): ReactElement {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(() => getSharedAnalyser());
  useEffect(() => {
    const read = () => setAnalyser((prev) => { const next = getSharedAnalyser(); return prev === next ? prev : next; });
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, [playing]);
  const state = useAnalyzerState(analyser, playing);
  return (
    <div data-testid="radio-spectrum" className={`relative h-14 w-full overflow-hidden rounded-lg border border-neutral-800 bg-black/40 ${className}`}>
      <ArchiveMusicSpectrum analyser={analyser} isPlaying={playing} analyzerState={state} />
    </div>
  );
}
