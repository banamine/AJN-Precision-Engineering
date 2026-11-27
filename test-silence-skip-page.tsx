import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useSilenceSkip } from './src/hooks/useSilenceSkip';

function App() {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [an, setAn] = useState<AnalyserNode | null>(null);
  useEffect(() => {
    const el = ref.current!; const ctx = new AudioContext(); const src = ctx.createMediaElementSource(el);
    const a = ctx.createAnalyser(); a.fftSize = 2048; src.connect(a); a.connect(ctx.destination); setAn(a); void ctx.resume();
  }, []);
  const api = useSilenceSkip(() => ref.current, an, true, Boolean(an), 'k');
  useEffect(() => { if (an && api.state === 'off') api.toggle(); }, [an, api]);
  useEffect(() => { const w = window as any; w.__log = []; const id = setInterval(() => { const e = ref.current!; w.__log.push([Number(e.currentTime.toFixed(2)), e.playbackRate, performance.now()]); }, 100); return () => clearInterval(id); }, []);
  return <div><audio ref={ref} src="/test-silence-skip.wav" data-testid="a" /><span data-testid="state">{api.state}</span><span data-testid="saved">{api.savedSec}</span></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
