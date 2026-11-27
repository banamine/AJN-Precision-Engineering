/* Browser harness for the Listen Alerts panel and the skip bar beside the captions. The runner (test-listen-alerts.mjs) answers /api/alerts/* itself. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ListenAlertsPanel } from './src/components/ListenAlertsPanel';
import { AlertSkipBar } from './src/components/AlertSkipBar';
import { PodcastStage } from './src/components/PodcastStage';
import { setAlertHits } from './src/utils/alertHitsStore';
import './src/index.css';

const w = window as any;
w.__plays = [] as unknown[][]; w.__jumps = [] as number[]; w.__setHits = setAlertHits;
const media = { currentTime: 100, duration: 3000, addEventListener() {} } as unknown as HTMLMediaElement;
w.__media = media;
const cues = Array.from({ length: 40 }, (_, i) => ({ s: i * 10, e: i * 10 + 4, t: `line ${i}` }));

function Bar() {
  const [state] = useState('locked');
  // jumpTo does NOT move the index: the captions are slower than the taps, which is exactly what the skip bar must cope with.
  const cap = { view: { state, cues, hasSpeakers: false, index: 10, ad: null, sponsor: null, autoSync: true, meter: false }, jumpTo: (i: number) => { w.__jumps.push(i); } } as any;
  return <AlertSkipBar cap={cap} getMedia={() => media} episodeId="pod-a-x1" />;
}
const params = new URLSearchParams(window.location.search);
if (params.get('stage')) {
  // The real caption player (usePodcastCaptions) inside the real PodcastStage, on a fake <audio>: the runner serves the transcript.
  const audio = document.createElement('audio'); let t = 105;
  Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => t, set: (v: number) => { t = Number(v) || 0; } });
  Object.defineProperty(audio, 'duration', { configurable: true, get: () => 3000 });
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
  w.__audio = audio;
  createRoot(document.getElementById('root')!).render(<div style={{ position: 'relative', height: 520 }}><PodcastStage getMedia={() => audio} source={{ url: 'https://cdn.example/a/1.mp3', showKey: params.get('show') ?? 'pod-a', episodeId: 'pod-a-x1', canMap: true }} analyser={null} meter={false} title="Show A" showName="Show A" artUrl={params.get("art") === "1" ? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" : undefined} /></div>);
} else
createRoot(document.getElementById('root')!).render(<><ListenAlertsPanel onPlayProgram={(...a: unknown[]) => { w.__plays.push(a); }} /><Bar /></>);
