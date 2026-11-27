import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioNormalization } from './src/use-audio-normalization';

// Tap what really reaches the speakers, so the test measures sound, not gain bookkeeping.
const w = window as any; const C = AudioNode.prototype.connect; w.__taps = [];
(AudioNode.prototype as any).connect = function (d: any, ...a: any[]) { const r = (C as any).call(this, d, ...a); try { if (d && d.constructor && d.constructor.name === 'AudioDestinationNode') { const an = this.context.createAnalyser(); an.fftSize = 1024; (C as any).call(this, an); w.__taps.push(an); } } catch { /* tap only */ } return r; };
w.__rms = (): number => { const an = w.__taps[w.__taps.length - 1]; if (!an) return -1; const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); };

function App() {
  const ref = useRef<HTMLAudioElement | null>(null);
  const n = useAudioNormalization(ref, 'audio', 'k', 'talk');
  w.__n = n; w.__el = () => ref.current;
  return <div><audio ref={ref} src="/test-master-gate.wav" crossOrigin="anonymous" loop data-testid="a" /><button data-testid="go" onClick={() => { n.primeAudioContext(); void ref.current!.play(); }}>go</button><span data-testid="bridge">{String(n.bridgeReady)}</span></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
